from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field

from app.database import get_db
from app.models import Grade, User, UserRole, ParentStudent
from app.routers.users import require_role

router = APIRouter(prefix="/api/grades", tags=["grades"])


class GradeCreate(BaseModel):
    student_id: int
    subject: str
    value: float = Field(..., ge=1, le=5)
    assignment_id: int | None = None
    comment: str | None = None


class GradeResponse(BaseModel):
    id: int
    student_id: int
    subject: str
    value: float
    assignment_id: int | None
    comment: str | None
    graded_by_id: int
    graded_at: datetime

    class Config:
        from_attributes = True


class SubjectAverage(BaseModel):
    subject: str
    average: float
    count: int


@router.post("", response_model=GradeResponse, status_code=201)
def add_grade(
    body: GradeCreate,
    current_user: User = Depends(require_role(UserRole.teacher)),
    db: Session = Depends(get_db),
):
    grade = Grade(
        student_id=body.student_id,
        subject=body.subject,
        value=body.value,
        assignment_id=body.assignment_id,
        comment=body.comment,
        graded_by_id=current_user.id,
    )
    db.add(grade)
    db.commit()
    db.refresh(grade)
    return grade


@router.get("/my", response_model=list[GradeResponse])
def my_grades(
    subject: str | None = None,
    current_user: User = Depends(require_role(UserRole.student)),
    db: Session = Depends(get_db),
):
    query = db.query(Grade).filter(Grade.student_id == current_user.id)
    if subject:
        query = query.filter(Grade.subject == subject)
    return query.order_by(Grade.graded_at.desc()).all()


@router.get("/my/averages", response_model=list[SubjectAverage])
def my_averages(
    current_user: User = Depends(require_role(UserRole.student)),
    db: Session = Depends(get_db),
):
    grades = db.query(Grade).filter(Grade.student_id == current_user.id).all()
    by_subject: dict[str, list[float]] = {}
    for g in grades:
        by_subject.setdefault(g.subject, []).append(g.value)
    return [
        SubjectAverage(subject=s, average=round(sum(v) / len(v), 2), count=len(v))
        for s, v in by_subject.items()
    ]


@router.get("/child/{student_id}", response_model=list[GradeResponse])
def child_grades(
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
    return db.query(Grade).filter(Grade.student_id == student_id).order_by(Grade.graded_at.desc()).all()


@router.delete("/{grade_id}", status_code=204)
def delete_grade(
    grade_id: int,
    current_user: User = Depends(require_role(UserRole.teacher)),
    db: Session = Depends(get_db),
):
    grade = db.query(Grade).filter(
        Grade.id == grade_id,
        Grade.graded_by_id == current_user.id,
    ).first()
    if not grade:
        raise HTTPException(404, "Grade not found")
    db.delete(grade)
    db.commit()
