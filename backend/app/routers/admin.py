import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models import InviteCode, User, UserRole
from app.routers.users import require_role

router = APIRouter(prefix="/api/admin", tags=["admin"])


class InviteCodeResponse(BaseModel):
    id: int
    code: str
    is_used: bool
    used_by_id: int | None
    created_at: datetime

    class Config:
        from_attributes = True


@router.post("/invite-codes", response_model=InviteCodeResponse, status_code=201)
def generate_invite_code(
    current_user: User = Depends(require_role(UserRole.admin)),
    db: Session = Depends(get_db),
):
    code = secrets.token_hex(8).upper()
    invite = InviteCode(code=code, created_by_id=current_user.id)
    db.add(invite)
    db.commit()
    db.refresh(invite)
    return invite


@router.get("/invite-codes", response_model=list[InviteCodeResponse])
def list_invite_codes(
    current_user: User = Depends(require_role(UserRole.admin)),
    db: Session = Depends(get_db),
):
    return db.query(InviteCode).order_by(InviteCode.created_at.desc()).all()


@router.delete("/invite-codes/{code_id}", status_code=204)
def delete_invite_code(
    code_id: int,
    current_user: User = Depends(require_role(UserRole.admin)),
    db: Session = Depends(get_db),
):
    invite = db.query(InviteCode).filter(InviteCode.id == code_id).first()
    if not invite:
        raise HTTPException(404, "Invite code not found")
    if invite.is_used:
        raise HTTPException(400, "Cannot delete already used code")
    db.delete(invite)
    db.commit()
