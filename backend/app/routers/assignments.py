from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models import Assignment, Class, ClassMembership, Task, User, UserRole, TaskPriority, TaskStatus
from app.routers.users import get_current_user, require_role

router = APIRouter(prefix="/api/assignments", tags=["assignments"])


class AssignmentCreate(BaseModel):
    title: str
    subject: str
    description: str | None = None
    deadline: datetime
    class_id: int
    priority: TaskPriority = TaskPriority.medium
    student_ids: list[int] | None = None


class AssignmentResponse(BaseModel):
    id: int
    title: str
    subject: str
    description: str | None
    deadline: datetime
    class_id: int
    priority: TaskPriority
    created_at: datetime
    submitted_count: int = 0
    total_count: int = 0

    class Config:
        from_attributes = True


@router.post("", response_model=AssignmentResponse, status_code=201)
def create_assignment(
    body: AssignmentCreate,
    current_user: User = Depends(require_role(UserRole.teacher)),
    db: Session = Depends(get_db),
):
    class_ = db.query(Class).filter(
        Class.id == body.class_id,
        Class.teacher_id == current_user.id,
    ).first()
    if not class_:
        raise HTTPException(404, "Class not found")

    assignment = Assignment(
        title=body.title,
        subject=body.subject,
        description=body.description,
        deadline=body.deadline,
        class_id=body.class_id,
        teacher_id=current_user.id,
        priority=body.priority,
    )
    db.add(assignment)
    db.flush()

    if body.student_ids:
        student_ids = body.student_ids
    else:
        memberships = db.query(ClassMembership).filter(ClassMembership.class_id == body.class_id).all()
        student_ids = [m.student_id for m in memberships]

    for sid in student_ids:
        db.add(Task(
            student_id=sid,
            assignment_id=assignment.id,
            title=body.title,
            subject=body.subject,
            description=body.description,
            deadline=body.deadline,
            priority=body.priority,
            is_personal=False,
        ))

    db.commit()
    db.refresh(assignment)
    assignment.total_count = len(student_ids)
    assignment.submitted_count = 0
    return assignment


@router.get("", response_model=list[AssignmentResponse])
def list_assignments(
    class_id: int | None = None,
    subject: str | None = None,
    current_user: User = Depends(require_role(UserRole.teacher)),
    db: Session = Depends(get_db),
):
    query = db.query(Assignment).filter(Assignment.teacher_id == current_user.id)
    if class_id:
        query = query.filter(Assignment.class_id == class_id)
    if subject:
        query = query.filter(Assignment.subject == subject)

    assignments = query.order_by(Assignment.deadline.asc()).all()
    for a in assignments:
        tasks = db.query(Task).filter(Task.assignment_id == a.id).all()
        a.total_count = len(tasks)
        a.submitted_count = sum(1 for t in tasks if t.status == TaskStatus.done)
    return assignments


@router.get("/{assignment_id}", response_model=AssignmentResponse)
def get_assignment(
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
    tasks = db.query(Task).filter(Task.assignment_id == assignment_id).all()
    assignment.total_count = len(tasks)
    assignment.submitted_count = sum(1 for t in tasks if t.status == TaskStatus.done)
    return assignment


@router.delete("/{assignment_id}", status_code=204)
def delete_assignment(
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
    db.delete(assignment)
    db.commit()
