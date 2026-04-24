from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Assignment, Class, ClassMembership, Grade, ParentStudent, User, UserRole
from app.routers.users import require_role

router = APIRouter(prefix="/api/grades", tags=["grades"])


class GradeCreate(BaseModel):
    student_id: int
    subject: str
    value: float = Field(..., ge=1, le=5)
    assignment_id: int | None = None
    comment: str | None = None


class BulkGradeItem(BaseModel):
    student_id: int
    value: float = Field(..., ge=1, le=5)
    comment: str | None = None


class BulkGradeCreate(BaseModel):
    assignment_id: int
    subject: str
    items: list[BulkGradeItem]


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


class GradeSummary(BaseModel):
    overall_average: float | None
    class_rank: int | None
    class_size: int | None
    best_subjects: list[SubjectAverage]
    weak_subjects: list[SubjectAverage]


def _assert_teacher_can_grade(
    current_user: User,
    db: Session,
    student_id: int,
    assignment_id: int | None,
) -> None:
    if assignment_id:
        assignment = db.query(Assignment).filter(
            Assignment.id == assignment_id,
            Assignment.teacher_id == current_user.id,
        ).first()
        if not assignment:
            raise HTTPException(404, "Assignment not found")
        membership = db.query(ClassMembership).filter(
            ClassMembership.class_id == assignment.class_id,
            ClassMembership.student_id == student_id,
        ).first()
        if not membership:
            raise HTTPException(400, "Student is not assigned to this class")
        return

    teacher_class_ids = [
        class_.id
        for class_ in db.query(Class).filter(Class.teacher_id == current_user.id).all()
    ]
    membership = db.query(ClassMembership).filter(
        ClassMembership.student_id == student_id,
        ClassMembership.class_id.in_(teacher_class_ids),
    ).first()
    if not membership:
        raise HTTPException(403, "Student does not belong to your classes")


@router.post("", response_model=GradeResponse, status_code=201)
def add_grade(
    body: GradeCreate,
    current_user: User = Depends(require_role(UserRole.teacher)),
    db: Session = Depends(get_db),
):
    _assert_teacher_can_grade(current_user, db, body.student_id, body.assignment_id)

    existing = None
    if body.assignment_id:
        existing = db.query(Grade).filter(
            Grade.student_id == body.student_id,
            Grade.assignment_id == body.assignment_id,
        ).first()

    if existing:
        existing.subject = body.subject
        existing.value = body.value
        existing.comment = body.comment
        existing.graded_by_id = current_user.id
        db.commit()
        db.refresh(existing)
        return existing

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


@router.post("/bulk", response_model=list[GradeResponse], status_code=201)
def add_bulk_grades(
    body: BulkGradeCreate,
    current_user: User = Depends(require_role(UserRole.teacher)),
    db: Session = Depends(get_db),
):
    assignment = db.query(Assignment).filter(
        Assignment.id == body.assignment_id,
        Assignment.teacher_id == current_user.id,
    ).first()
    if not assignment:
        raise HTTPException(404, "Assignment not found")

    response: list[GradeResponse] = []
    for item in body.items:
        _assert_teacher_can_grade(current_user, db, item.student_id, body.assignment_id)
        grade = db.query(Grade).filter(
            Grade.student_id == item.student_id,
            Grade.assignment_id == body.assignment_id,
        ).first()
        if grade:
            grade.value = item.value
            grade.comment = item.comment
            grade.subject = body.subject
            grade.graded_by_id = current_user.id
        else:
            grade = Grade(
                student_id=item.student_id,
                subject=body.subject,
                value=item.value,
                assignment_id=body.assignment_id,
                comment=item.comment,
                graded_by_id=current_user.id,
            )
            db.add(grade)

    db.commit()
    grades = db.query(Grade).filter(Grade.assignment_id == body.assignment_id).all()
    response.extend(grades)
    return response


@router.get("/assignment/{assignment_id}", response_model=list[GradeResponse])
def list_assignment_grades(
    assignment_id: int,
    current_user: User = Depends(require_role(UserRole.teacher)),
    db: Session = Depends(get_db),
):
    assignment = db.query(Assignment).filter(
        Assignment.id == assignment_id,
        Assignment.teacher_id == current_user.id,
    ).first()
    if not assignment:
        raise HTTPException(404, "Assignment not found")
    return db.query(Grade).filter(Grade.assignment_id == assignment_id).order_by(Grade.graded_at.desc()).all()


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
    for grade in grades:
        by_subject.setdefault(grade.subject, []).append(grade.value)
    return [
        SubjectAverage(subject=subject, average=round(sum(values) / len(values), 2), count=len(values))
        for subject, values in by_subject.items()
    ]


@router.get("/my/summary", response_model=GradeSummary)
def my_grade_summary(
    current_user: User = Depends(require_role(UserRole.student)),
    db: Session = Depends(get_db),
):
    grades = db.query(Grade).filter(Grade.student_id == current_user.id).all()
    by_subject: dict[str, list[float]] = {}
    for grade in grades:
        by_subject.setdefault(grade.subject, []).append(grade.value)

    subject_averages = [
        SubjectAverage(subject=subject, average=round(sum(values) / len(values), 2), count=len(values))
        for subject, values in by_subject.items()
    ]
    subject_averages.sort(key=lambda item: (-item.average, item.subject.lower()))

    overall_average = round(sum(grade.value for grade in grades) / len(grades), 2) if grades else None

    class_rank = None
    class_size = None
    membership = db.query(ClassMembership).filter(ClassMembership.student_id == current_user.id).first()
    if membership:
        memberships = db.query(ClassMembership).filter(ClassMembership.class_id == membership.class_id).all()
        student_ids = [item.student_id for item in memberships]
        class_size = len(student_ids)

        student_scores: list[tuple[int, float]] = []
        for student_id in student_ids:
            student_grades = db.query(Grade).filter(Grade.student_id == student_id).all()
            if not student_grades:
                continue
            average = sum(item.value for item in student_grades) / len(student_grades)
            student_scores.append((student_id, average))

        student_scores.sort(key=lambda item: item[1], reverse=True)
        for index, (student_id, _) in enumerate(student_scores, start=1):
            if student_id == current_user.id:
                class_rank = index
                break

    return GradeSummary(
        overall_average=overall_average,
        class_rank=class_rank,
        class_size=class_size,
        best_subjects=subject_averages[:4],
        weak_subjects=sorted(subject_averages, key=lambda item: (item.average, item.subject.lower()))[:3],
    )


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
