from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Assignment, Class, ClassMembership, Grade, Task, TaskPriority, TaskStatus, User, UserRole
from app.routers.users import require_role

router = APIRouter(prefix="/api/assignments", tags=["assignments"])


class AssignmentCreate(BaseModel):
    title: str
    subject: str | None = None
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
    class_name: str | None = None

    class Config:
        from_attributes = True


class AssignmentStudentProgress(BaseModel):
    student_id: int
    student_name: str
    email: str
    status: TaskStatus | None
    grade: float | None


class AssignmentProgressResponse(BaseModel):
    id: int
    title: str
    subject: str
    class_id: int
    class_name: str
    deadline: datetime
    priority: TaskPriority
    completed: int
    started: int
    not_started: int
    students: list[AssignmentStudentProgress]


def _teacher_assignment(assignment_id: int, teacher_id: int, db: Session) -> Assignment:
    assignment = db.query(Assignment).filter(
        Assignment.id == assignment_id,
        Assignment.teacher_id == teacher_id,
    ).first()
    if not assignment:
        raise HTTPException(404, "Assignment not found")
    return assignment


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
    subject = (body.subject or current_user.teacher_subject or "").strip()
    if not subject:
        raise HTTPException(400, "Teacher subject is not assigned")
    if current_user.teacher_subject and subject.lower() != current_user.teacher_subject.strip().lower():
        raise HTTPException(400, "You can create assignments only for your assigned subject")

    memberships = db.query(ClassMembership).filter(ClassMembership.class_id == body.class_id).all()
    available_student_ids = {membership.student_id for membership in memberships}
    if body.student_ids:
        student_ids = [student_id for student_id in body.student_ids if student_id in available_student_ids]
    else:
        student_ids = sorted(available_student_ids)

    assignment = Assignment(
        title=body.title.strip(),
        subject=subject,
        description=body.description,
        deadline=body.deadline,
        class_id=body.class_id,
        teacher_id=current_user.id,
        priority=body.priority,
    )
    db.add(assignment)
    db.flush()

    for student_id in student_ids:
        db.add(
            Task(
                student_id=student_id,
                assignment_id=assignment.id,
                title=body.title.strip(),
                subject=subject,
                description=body.description,
                deadline=body.deadline,
                priority=body.priority,
                is_personal=False,
            )
        )

    db.commit()
    db.refresh(assignment)
    assignment.total_count = len(student_ids)
    assignment.submitted_count = 0
    assignment.class_name = class_.name
    return assignment


@router.get("", response_model=list[AssignmentResponse])
def list_assignments(
    class_id: int | None = None,
    subject: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    current_user: User = Depends(require_role(UserRole.teacher)),
    db: Session = Depends(get_db),
):
    query = db.query(Assignment).filter(Assignment.teacher_id == current_user.id)
    if class_id:
        query = query.filter(Assignment.class_id == class_id)
    if subject:
        query = query.filter(Assignment.subject == subject)
    if date_from:
        query = query.filter(Assignment.deadline >= date_from)
    if date_to:
        query = query.filter(Assignment.deadline <= date_to)

    assignments = query.order_by(Assignment.deadline.asc()).all()
    class_lookup = {class_.id: class_.name for class_ in db.query(Class).filter(Class.teacher_id == current_user.id).all()}

    for assignment in assignments:
        tasks = db.query(Task).filter(Task.assignment_id == assignment.id).all()
        assignment.total_count = len(tasks)
        assignment.submitted_count = sum(1 for task in tasks if task.status == TaskStatus.done)
        assignment.class_name = class_lookup.get(assignment.class_id)
    return assignments


@router.get("/{assignment_id}", response_model=AssignmentResponse)
def get_assignment(
    assignment_id: int,
    current_user: User = Depends(require_role(UserRole.teacher)),
    db: Session = Depends(get_db),
):
    assignment = _teacher_assignment(assignment_id, current_user.id, db)
    tasks = db.query(Task).filter(Task.assignment_id == assignment_id).all()
    class_ = db.query(Class).filter(Class.id == assignment.class_id).first()
    assignment.total_count = len(tasks)
    assignment.submitted_count = sum(1 for task in tasks if task.status == TaskStatus.done)
    assignment.class_name = class_.name if class_ else None
    return assignment


@router.get("/{assignment_id}/progress", response_model=AssignmentProgressResponse)
def get_assignment_progress(
    assignment_id: int,
    current_user: User = Depends(require_role(UserRole.teacher)),
    db: Session = Depends(get_db),
):
    assignment = _teacher_assignment(assignment_id, current_user.id, db)
    class_ = db.query(Class).filter(Class.id == assignment.class_id).first()
    memberships = db.query(ClassMembership).filter(ClassMembership.class_id == assignment.class_id).all()
    tasks = db.query(Task).filter(Task.assignment_id == assignment.id).all()
    grades = db.query(Grade).filter(Grade.assignment_id == assignment.id).all()
    task_by_student = {task.student_id: task for task in tasks}
    grade_by_student = {grade.student_id: grade for grade in grades}

    completed = started = not_started = 0
    students: list[AssignmentStudentProgress] = []
    for membership in memberships:
        student = membership.student
        task = task_by_student.get(student.id)
        grade = grade_by_student.get(student.id)
        status = task.status if task else None
        if status == TaskStatus.done:
            completed += 1
        elif status in {TaskStatus.in_progress, TaskStatus.overdue}:
            started += 1
        else:
            not_started += 1
        students.append(
            AssignmentStudentProgress(
                student_id=student.id,
                student_name=f"{student.last_name} {student.first_name}".strip(),
                email=student.email,
                status=status,
                grade=grade.value if grade else None,
            )
        )

    students.sort(key=lambda item: item.student_name.lower())
    return AssignmentProgressResponse(
        id=assignment.id,
        title=assignment.title,
        subject=assignment.subject,
        class_id=assignment.class_id,
        class_name=class_.name if class_ else "",
        deadline=assignment.deadline,
        priority=assignment.priority,
        completed=completed,
        started=started,
        not_started=not_started,
        students=students,
    )


@router.delete("/{assignment_id}", status_code=204)
def delete_assignment(
    assignment_id: int,
    current_user: User = Depends(require_role(UserRole.teacher)),
    db: Session = Depends(get_db),
):
    assignment = _teacher_assignment(assignment_id, current_user.id, db)
    db.delete(assignment)
    db.commit()
