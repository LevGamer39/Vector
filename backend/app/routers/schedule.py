from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field

from app.database import get_db
from app.models import Schedule, User, UserRole, ParentStudent
from app.routers.users import require_role

router = APIRouter(prefix="/api/schedule", tags=["schedule"])


class ScheduleEntryCreate(BaseModel):
    subject: str
    teacher_name: str | None = None
    weekday: int = Field(..., ge=0, le=6)
    start_time: str
    end_time: str
    room: str | None = None


class ScheduleEntryResponse(BaseModel):
    id: int
    subject: str
    teacher_name: str | None
    weekday: int
    start_time: str
    end_time: str
    room: str | None

    class Config:
        from_attributes = True


@router.post("", response_model=ScheduleEntryResponse, status_code=201)
def add_entry(
    body: ScheduleEntryCreate,
    current_user: User = Depends(require_role(UserRole.student)),
    db: Session = Depends(get_db),
):
    entry = Schedule(student_id=current_user.id, **body.model_dump())
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@router.get("/my", response_model=list[ScheduleEntryResponse])
def my_schedule(
    weekday: int | None = None,
    current_user: User = Depends(require_role(UserRole.student)),
    db: Session = Depends(get_db),
):
    query = db.query(Schedule).filter(Schedule.student_id == current_user.id)
    if weekday is not None:
        query = query.filter(Schedule.weekday == weekday)
    return query.order_by(Schedule.weekday, Schedule.start_time).all()


@router.put("/{entry_id}", response_model=ScheduleEntryResponse)
def update_entry(
    entry_id: int,
    body: ScheduleEntryCreate,
    current_user: User = Depends(require_role(UserRole.student)),
    db: Session = Depends(get_db),
):
    entry = db.query(Schedule).filter(
        Schedule.id == entry_id,
        Schedule.student_id == current_user.id,
    ).first()
    if not entry:
        raise HTTPException(404, "Entry not found")
    for field, value in body.model_dump().items():
        setattr(entry, field, value)
    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/{entry_id}", status_code=204)
def delete_entry(
    entry_id: int,
    current_user: User = Depends(require_role(UserRole.student)),
    db: Session = Depends(get_db),
):
    entry = db.query(Schedule).filter(
        Schedule.id == entry_id,
        Schedule.student_id == current_user.id,
    ).first()
    if not entry:
        raise HTTPException(404, "Entry not found")
    db.delete(entry)
    db.commit()


@router.get("/child/{student_id}", response_model=list[ScheduleEntryResponse])
def child_schedule(
    student_id: int,
    current_user: User = Depends(require_role(UserRole.parent)),
    db: Session = Depends(get_db),
):
    link = db.query(ParentStudent).filter(
        ParentStudent.parent_id == current_user.id,
        ParentStudent.student_id == student_id,
    ).first()
    if not link:
        raise HTTPException(403, "Not your child")
    return db.query(Schedule).filter(Schedule.student_id == student_id).order_by(Schedule.weekday, Schedule.start_time).all()
