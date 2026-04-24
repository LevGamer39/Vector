import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Assignment, Class, ClassMembership, Grade, Task, TaskStatus, User, UserRole
from app.routers.users import get_current_user, require_role

router = APIRouter(prefix="/api/classes", tags=["classes"])


class ClassCreate(BaseModel):
    name: str


class ClassResponse(BaseModel):
    id: int
    name: str
    subject: str | None = None
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


class StudentProgressRow(BaseModel):
    student_id: int
    name: str
    email: str
    status: TaskStatus | None
    score: float | None
    grade: float | None


class AssignmentOption(BaseModel):
    id: int
    title: str
    subject: str
    deadline: datetime


class ClassAssignmentMatrix(BaseModel):
    assignment_id: int
    title: str
    subject: str
    deadline: datetime
    submitted_count: int
    total_count: int


class StudentAssignmentCell(BaseModel):
    assignment_id: int
    status: TaskStatus | None
    grade: float | None


class ClassStudentDetail(BaseModel):
    id: int
    name: str
    email: str
    grade: str | None
    assignments: list[StudentAssignmentCell]


class ClassDetail(ClassResponse):
    students: list[StudentResponse]
    assignments: list[ClassAssignmentMatrix]


class DashboardStatistics(BaseModel):
    completed: int
    started: int
    not_started: int


class DashboardPagination(BaseModel):
    page: int
    page_size: int
    total_pages: int
    total_items: int


class TeacherDashboardResponse(BaseModel):
    class_id: int
    class_name: str
    class_subject: str | None = None
    subjects: list[str]
    selected_subject: str | None
    assignments: list[AssignmentOption]
    selected_assignment_id: int | None
    students: list[StudentProgressRow]
    statistics: DashboardStatistics
    pagination: DashboardPagination


def _class_for_teacher(class_id: int, teacher_id: int, db: Session) -> Class:
    class_ = db.query(Class).filter(
        Class.id == class_id,
        Class.teacher_id == teacher_id,
    ).first()
    if not class_:
        raise HTTPException(404, "Class not found")
    return class_


def _student_label(student: User) -> str:
    return f"{student.last_name} {student.first_name}".strip()


def _score_from_grade(grade_value: float | None, status: TaskStatus | None) -> float | None:
    if grade_value is not None:
        return round((grade_value / 5) * 100, 1)
    if status == TaskStatus.done:
        return 100.0
    return None


def _assignment_options(class_id: int, subject: str | None, db: Session) -> list[Assignment]:
    query = db.query(Assignment).filter(Assignment.class_id == class_id)
    if subject:
        query = query.filter(Assignment.subject == subject)
    return query.order_by(Assignment.deadline.desc(), Assignment.created_at.desc()).all()


@router.post("", response_model=ClassResponse, status_code=201)
def create_class(
    body: ClassCreate,
    current_user: User = Depends(require_role(UserRole.teacher)),
    db: Session = Depends(get_db),
):
    raise HTTPException(403, "Only admin can create classes")


@router.get("", response_model=list[ClassResponse])
def list_classes(
    current_user: User = Depends(require_role(UserRole.teacher)),
    db: Session = Depends(get_db),
):
    classes = db.query(Class).filter(Class.teacher_id == current_user.id).order_by(Class.name.asc()).all()
    for class_ in classes:
        class_.student_count = db.query(ClassMembership).filter(ClassMembership.class_id == class_.id).count()
    return classes


@router.get("/available")
def list_available_class_names(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    names = sorted({item.name for item in db.query(Class).all() if item.name})
    return [{"name": name} for name in names]


@router.get("/dashboard", response_model=TeacherDashboardResponse)
def teacher_dashboard_data(
    class_id: int,
    assignment_id: int | None = None,
    subject: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    current_user: User = Depends(require_role(UserRole.teacher)),
    db: Session = Depends(get_db),
):
    class_ = _class_for_teacher(class_id, current_user.id, db)

    memberships = db.query(ClassMembership).filter(ClassMembership.class_id == class_id).all()
    students = [membership.student for membership in memberships]

    all_assignments = db.query(Assignment).filter(Assignment.class_id == class_id).order_by(
        Assignment.deadline.desc(),
        Assignment.created_at.desc(),
    ).all()
    subjects = sorted({assignment.subject for assignment in all_assignments if assignment.subject})

    filtered_assignments = [assignment for assignment in all_assignments if not subject or assignment.subject == subject]
    selected_assignment = None
    if assignment_id:
        selected_assignment = next((assignment for assignment in filtered_assignments if assignment.id == assignment_id), None)
    if not selected_assignment and filtered_assignments:
        selected_assignment = filtered_assignments[0]

    student_rows: list[StudentProgressRow] = []
    completed = started = not_started = 0

    if selected_assignment:
        tasks = db.query(Task).filter(Task.assignment_id == selected_assignment.id).all()
        task_by_student = {task.student_id: task for task in tasks}
        grades = db.query(Grade).filter(Grade.assignment_id == selected_assignment.id).all()
        grade_by_student = {grade.student_id: grade for grade in grades}

        for student in students:
            task = task_by_student.get(student.id)
            grade = grade_by_student.get(student.id)
            status = task.status if task else None
            if status == TaskStatus.done:
                completed += 1
            elif status in {TaskStatus.in_progress, TaskStatus.overdue}:
                started += 1
            else:
                not_started += 1

            grade_value = grade.value if grade else None
            student_rows.append(
                StudentProgressRow(
                    student_id=student.id,
                    name=_student_label(student),
                    email=student.email,
                    status=status,
                    score=_score_from_grade(grade_value, status),
                    grade=grade_value,
                )
            )
    else:
        completed = started = not_started = 0

    student_rows.sort(key=lambda item: item.name.lower())
    total_items = len(student_rows)
    total_pages = max(1, (total_items + page_size - 1) // page_size)
    start = (page - 1) * page_size
    paged_rows = student_rows[start:start + page_size]

    return TeacherDashboardResponse(
        class_id=class_.id,
        class_name=class_.name,
        class_subject=class_.subject,
        subjects=subjects,
        selected_subject=subject or (selected_assignment.subject if selected_assignment else None),
        assignments=[
            AssignmentOption(
                id=assignment.id,
                title=assignment.title,
                subject=assignment.subject,
                deadline=assignment.deadline,
            )
            for assignment in filtered_assignments
        ],
        selected_assignment_id=selected_assignment.id if selected_assignment else None,
        students=paged_rows,
        statistics=DashboardStatistics(
            completed=completed,
            started=started,
            not_started=not_started,
        ),
        pagination=DashboardPagination(
            page=page,
            page_size=page_size,
            total_pages=total_pages,
            total_items=total_items,
        ),
    )


@router.get("/{class_id}", response_model=ClassDetail)
def get_class(
    class_id: int,
    current_user: User = Depends(require_role(UserRole.teacher)),
    db: Session = Depends(get_db),
):
    class_ = _class_for_teacher(class_id, current_user.id, db)

    memberships = db.query(ClassMembership).filter(ClassMembership.class_id == class_id).all()
    students = [
        StudentResponse(
            id=membership.student.id,
            name=_student_label(membership.student),
            email=membership.student.email,
            grade=membership.student.grade,
        )
        for membership in memberships
    ]

    assignments = db.query(Assignment).filter(Assignment.class_id == class_id).order_by(Assignment.deadline.desc()).all()
    assignment_items: list[ClassAssignmentMatrix] = []
    for assignment in assignments:
        tasks = db.query(Task).filter(Task.assignment_id == assignment.id).all()
        total_count = len(tasks)
        submitted_count = sum(1 for task in tasks if task.status == TaskStatus.done)
        assignment_items.append(
            ClassAssignmentMatrix(
                assignment_id=assignment.id,
                title=assignment.title,
                subject=assignment.subject,
                deadline=assignment.deadline,
                submitted_count=submitted_count,
                total_count=total_count,
            )
        )

    return ClassDetail(
        id=class_.id,
        name=class_.name,
        invite_code=class_.invite_code,
        student_count=len(students),
        created_at=class_.created_at,
        students=students,
        assignments=assignment_items,
    )


@router.get("/{class_id}/overview")
def get_class_overview(
    class_id: int,
    current_user: User = Depends(require_role(UserRole.teacher)),
    db: Session = Depends(get_db),
):
    class_ = _class_for_teacher(class_id, current_user.id, db)

    memberships = db.query(ClassMembership).filter(ClassMembership.class_id == class_id).all()
    students = [membership.student for membership in memberships]
    assignments = db.query(Assignment).filter(Assignment.class_id == class_id).order_by(Assignment.deadline.desc()).all()

    tasks = db.query(Task).join(Assignment, Task.assignment_id == Assignment.id).filter(Assignment.class_id == class_id).all()
    grades = db.query(Grade).join(Assignment, Grade.assignment_id == Assignment.id).filter(Assignment.class_id == class_id).all()

    task_lookup = {(task.student_id, task.assignment_id): task for task in tasks if task.assignment_id}
    grade_lookup = {(grade.student_id, grade.assignment_id): grade for grade in grades if grade.assignment_id}

    student_items: list[ClassStudentDetail] = []
    for student in sorted(students, key=_student_label):
        student_items.append(
            ClassStudentDetail(
                id=student.id,
                name=_student_label(student),
                email=student.email,
                grade=student.grade,
                assignments=[
                    StudentAssignmentCell(
                        assignment_id=assignment.id,
                        status=task_lookup.get((student.id, assignment.id)).status if task_lookup.get((student.id, assignment.id)) else None,
                        grade=grade_lookup.get((student.id, assignment.id)).value if grade_lookup.get((student.id, assignment.id)) else None,
                    )
                    for assignment in assignments
                ],
            )
        )

    return {
        "id": class_.id,
        "name": class_.name,
        "invite_code": class_.invite_code,
        "student_count": len(students),
        "created_at": class_.created_at,
        "students": [item.model_dump() for item in student_items],
        "assignments": [
            {
                "id": assignment.id,
                "title": assignment.title,
                "subject": assignment.subject,
                "deadline": assignment.deadline,
            }
            for assignment in assignments
        ],
    }


@router.delete("/{class_id}/students/{student_id}", status_code=204)
def remove_student(
    class_id: int,
    student_id: int,
    current_user: User = Depends(require_role(UserRole.teacher)),
    db: Session = Depends(get_db),
):
    _class_for_teacher(class_id, current_user.id, db)
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

    membership = db.query(ClassMembership).filter(
        ClassMembership.student_id == current_user.id,
    ).first()
    if membership and membership.class_id == class_.id:
        raise HTTPException(400, "Already in this class")
    if membership:
        membership.class_id = class_.id
    else:
        db.add(ClassMembership(student_id=current_user.id, class_id=class_.id))
    current_user.grade = class_.name
    db.commit()
    return {"message": f"Joined class {class_.name}"}
