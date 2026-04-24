import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models import Class, ClassMembership, User, UserRole, Assignment
from app.routers.users import get_current_user, require_role

router = APIRouter(prefix="/api/classes", tags=["classes"])


class ClassCreate(BaseModel):
    name: str


class ClassResponse(BaseModel):
    id: int
    name: str
    invite_code: str
    student_count: int
    created_at: datetime

    class Config:
        from_attributes = True


class StudentResponse(BaseModel):
    id: int
    name: str
    email: str
    grade: str | None

    class Config:
        from_attributes = True


class ClassDetail(ClassResponse):
    students: list[StudentResponse]



@router.post("", response_model=ClassResponse, status_code=201)
def create_class(
    body: ClassCreate,
    current_user: User = Depends(require_role(UserRole.teacher)),
    db: Session = Depends(get_db),
):
    class_ = Class(
        name=body.name,
        teacher_id=current_user.id,
        invite_code=secrets.token_hex(6).upper(),
    )
    db.add(class_)
    db.commit()
    db.refresh(class_)
    class_.student_count = 0
    return class_


@router.get("", response_model=list[ClassResponse])
def list_classes(
    current_user: User = Depends(require_role(UserRole.teacher)),
    db: Session = Depends(get_db),
):
    classes = db.query(Class).filter(Class.teacher_id == current_user.id).all()
    for c in classes:
        c.student_count = db.query(ClassMembership).filter(ClassMembership.class_id == c.id).count()
    return classes


@router.get("/available")
def list_available_class_names(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    names = sorted({item.name for item in db.query(Class).all() if item.name})
    return [{"name": name} for name in names]


@router.get("/{class_id}", response_model=ClassDetail)
def get_class(
    class_id: int,
    current_user: User = Depends(require_role(UserRole.teacher)),
    db: Session = Depends(get_db),
):
    class_ = db.query(Class).filter(Class.id == class_id, Class.teacher_id == current_user.id).first()
    if not class_:
        raise HTTPException(404, "Class not found")

    memberships = db.query(ClassMembership).filter(ClassMembership.class_id == class_id).all()
    students = [m.student for m in memberships]
    class_.student_count = len(students)
    class_.students = students
    return class_


@router.delete("/{class_id}/students/{student_id}", status_code=204)
def remove_student(
    class_id: int,
    student_id: int,
    current_user: User = Depends(require_role(UserRole.teacher)),
    db: Session = Depends(get_db),
):
    class_ = db.query(Class).filter(Class.id == class_id, Class.teacher_id == current_user.id).first()
    if not class_:
        raise HTTPException(404, "Class not found")
    membership = db.query(ClassMembership).filter(
        ClassMembership.class_id == class_id,
        ClassMembership.student_id == student_id,
    ).first()
    if not membership:
        raise HTTPException(404, "Student not in this class")
    db.delete(membership)
    db.commit()


@router.post("/join")
def join_class(
    invite_code: str,
    current_user: User = Depends(require_role(UserRole.student)),
    db: Session = Depends(get_db),
):
    class_ = db.query(Class).filter(Class.invite_code == invite_code).first()
    if not class_:
        raise HTTPException(404, "Invalid invite code")

    already = db.query(ClassMembership).filter(
        ClassMembership.class_id == class_.id,
        ClassMembership.student_id == current_user.id,
    ).first()
    if already:
        raise HTTPException(400, "Already in this class")

    db.add(ClassMembership(student_id=current_user.id, class_id=class_.id))
    db.commit()
    return {"message": f"Joined class {class_.name}"}
