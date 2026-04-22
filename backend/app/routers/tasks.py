from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models import Task, User, UserRole, TaskStatus, TaskPriority, ParentStudent
from app.routers.users import get_current_user, require_role

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


class TaskCreate(BaseModel):
    title: str
    subject: str | None = None
    description: str | None = None
    deadline: datetime | None = None
    priority: TaskPriority = TaskPriority.medium


class TaskUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    deadline: datetime | None = None
    status: TaskStatus | None = None
    priority: TaskPriority | None = None


class TaskResponse(BaseModel):
    id: int
    title: str
    subject: str | None
    description: str | None
    deadline: datetime | None
    status: TaskStatus
    priority: TaskPriority
    is_personal: bool
    assignment_id: int | None
    parent_task_id: int | None
    ai_suggested_time: str | None
    created_at: datetime
    completed_at: datetime | None

    class Config:
        from_attributes = True


def _own_task(task_id: int, user: User, db: Session) -> Task:
    task = db.query(Task).filter(Task.id == task_id, Task.student_id == user.id).first()
    if not task:
        raise HTTPException(404, "Task not found")
    return task


@router.post("", response_model=TaskResponse, status_code=201)
def create_personal_task(
    body: TaskCreate,
    current_user: User = Depends(require_role(UserRole.student)),
    db: Session = Depends(get_db),
):
    task = Task(
        student_id=current_user.id,
        title=body.title,
        subject=body.subject,
        description=body.description,
        deadline=body.deadline,
        priority=body.priority,
        is_personal=True,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


@router.get("", response_model=list[TaskResponse])
def list_tasks(
    status: TaskStatus | None = None,
    subject: str | None = None,
    current_user: User = Depends(require_role(UserRole.student)),
    db: Session = Depends(get_db),
):
    query = db.query(Task).filter(Task.student_id == current_user.id, Task.parent_task_id == None)
    if status:
        query = query.filter(Task.status == status)
    if subject:
        query = query.filter(Task.subject == subject)
    return query.order_by(Task.deadline.asc().nullslast()).all()


@router.get("/{task_id}", response_model=TaskResponse)
def get_task(
    task_id: int,
    current_user: User = Depends(require_role(UserRole.student)),
    db: Session = Depends(get_db),
):
    return _own_task(task_id, current_user, db)


@router.get("/{task_id}/subtasks", response_model=list[TaskResponse])
def get_subtasks(
    task_id: int,
    current_user: User = Depends(require_role(UserRole.student)),
    db: Session = Depends(get_db),
):
    _own_task(task_id, current_user, db)
    return db.query(Task).filter(Task.parent_task_id == task_id).all()


@router.patch("/{task_id}", response_model=TaskResponse)
def update_task(
    task_id: int,
    body: TaskUpdate,
    current_user: User = Depends(require_role(UserRole.student)),
    db: Session = Depends(get_db),
):
    task = _own_task(task_id, current_user, db)
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(task, field, value)
    if body.status == TaskStatus.done and not task.completed_at:
        task.completed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(task)
    return task


@router.post("/{task_id}/complete", response_model=TaskResponse)
def complete_task(
    task_id: int,
    current_user: User = Depends(require_role(UserRole.student)),
    db: Session = Depends(get_db),
):
    task = _own_task(task_id, current_user, db)
    task.status = TaskStatus.done
    task.completed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(task)
    return task


@router.delete("/{task_id}", status_code=204)
def delete_task(
    task_id: int,
    current_user: User = Depends(require_role(UserRole.student)),
    db: Session = Depends(get_db),
):
    task = _own_task(task_id, current_user, db)
    if not task.is_personal:
        raise HTTPException(400, "Cannot delete teacher-assigned tasks")
    db.delete(task)
    db.commit()


@router.get("/child/{student_id}", response_model=list[TaskResponse])
def get_child_tasks(
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
    return db.query(Task).filter(Task.student_id == student_id, Task.parent_task_id == None).order_by(Task.deadline.asc().nullslast()).all()
