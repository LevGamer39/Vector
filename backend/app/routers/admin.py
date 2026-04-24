import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Class, ClassMembership, InviteCode, User, UserRole
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


class AdminTeacherResponse(BaseModel):
    id: int
    first_name: str
    last_name: str
    email: str
    teacher_subject: str | None = None
    class_count: int


class AdminStudentResponse(BaseModel):
    id: int
    first_name: str
    last_name: str
    email: str
    grade: str | None
    is_active: bool
    class_id: int | None = None
    class_name: str | None = None


class AdminClassResponse(BaseModel):
    id: int
    name: str
    invite_code: str
    teacher_id: int
    teacher_name: str
    student_count: int
    created_at: datetime

    class Config:
        from_attributes = True


class AdminDashboardResponse(BaseModel):
    teachers_count: int
    students_count: int
    classes_count: int
    invite_codes_count: int
    classes: list[AdminClassResponse]
    teachers: list[AdminTeacherResponse]
    students: list[AdminStudentResponse]


class AdminClassCreate(BaseModel):
    name: str
    teacher_id: int
    student_ids: list[int] | None = None


class AdminClassUpdate(BaseModel):
    name: str | None = None
    teacher_id: int | None = None


class AdminClassStudentAdd(BaseModel):
    student_id: int


class AdminUserUpdate(BaseModel):
    is_active: bool | None = None
    grade: str | None = None
    teacher_subject: str | None = None


def _teacher_name(teacher: User | None) -> str:
    if not teacher:
        return "Не назначен"
    return f"{teacher.first_name} {teacher.last_name}".strip()


def _serialize_class(class_: Class, db: Session) -> AdminClassResponse:
    teacher = db.query(User).filter(User.id == class_.teacher_id).first()
    student_count = db.query(ClassMembership).filter(ClassMembership.class_id == class_.id).count()
    return AdminClassResponse(
        id=class_.id,
        name=class_.name,
        invite_code=class_.invite_code,
        teacher_id=class_.teacher_id,
        teacher_name=_teacher_name(teacher),
        student_count=student_count,
        created_at=class_.created_at,
    )


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


@router.get("/teachers", response_model=list[AdminTeacherResponse])
def list_teachers(
    current_user: User = Depends(require_role(UserRole.admin)),
    db: Session = Depends(get_db),
):
    teachers = db.query(User).filter(User.role == UserRole.teacher).order_by(User.last_name.asc()).all()
    return [
        AdminTeacherResponse(
            id=teacher.id,
            first_name=teacher.first_name,
            last_name=teacher.last_name,
            email=teacher.email,
            teacher_subject=teacher.teacher_subject,
            class_count=db.query(Class).filter(Class.teacher_id == teacher.id).count(),
        )
        for teacher in teachers
    ]


@router.get("/students", response_model=list[AdminStudentResponse])
def list_students(
    class_id: int | None = None,
    current_user: User = Depends(require_role(UserRole.admin)),
    db: Session = Depends(get_db),
):
    students = db.query(User).filter(User.role == UserRole.student).order_by(User.last_name.asc()).all()
    memberships = db.query(ClassMembership).all()
    class_lookup = {class_.id: class_ for class_ in db.query(Class).all()}
    membership_by_student = {membership.student_id: membership.class_id for membership in memberships}

    response: list[AdminStudentResponse] = []
    for student in students:
        assigned_class_id = membership_by_student.get(student.id)
        if class_id and assigned_class_id != class_id:
            continue
        assigned_class = class_lookup.get(assigned_class_id) if assigned_class_id else None
        response.append(
            AdminStudentResponse(
                id=student.id,
                first_name=student.first_name,
                last_name=student.last_name,
                email=student.email,
                grade=student.grade,
                is_active=student.is_active,
                class_id=assigned_class_id,
                class_name=assigned_class.name if assigned_class else None,
            )
        )
    return response


@router.get("/classes", response_model=list[AdminClassResponse])
def list_classes(
    current_user: User = Depends(require_role(UserRole.admin)),
    db: Session = Depends(get_db),
):
    classes = db.query(Class).order_by(Class.name.asc()).all()
    return [_serialize_class(class_, db) for class_ in classes]


@router.post("/classes", response_model=AdminClassResponse, status_code=201)
def create_class(
    body: AdminClassCreate,
    current_user: User = Depends(require_role(UserRole.admin)),
    db: Session = Depends(get_db),
):
    teacher = db.query(User).filter(User.id == body.teacher_id, User.role == UserRole.teacher).first()
    if not teacher:
        raise HTTPException(404, "Teacher not found")

    class_ = Class(
        name=body.name.strip(),
        teacher_id=body.teacher_id,
        invite_code=secrets.token_hex(6).upper(),
    )
    db.add(class_)
    db.flush()

    for student_id in body.student_ids or []:
        student = db.query(User).filter(User.id == student_id, User.role == UserRole.student).first()
        if not student:
            continue
        existing = db.query(ClassMembership).filter(ClassMembership.student_id == student_id).first()
        if existing:
            existing.class_id = class_.id
        else:
            db.add(ClassMembership(student_id=student_id, class_id=class_.id))

    db.commit()
    db.refresh(class_)
    return _serialize_class(class_, db)


@router.patch("/classes/{class_id}", response_model=AdminClassResponse)
def update_class(
    class_id: int,
    body: AdminClassUpdate,
    current_user: User = Depends(require_role(UserRole.admin)),
    db: Session = Depends(get_db),
):
    class_ = db.query(Class).filter(Class.id == class_id).first()
    if not class_:
        raise HTTPException(404, "Class not found")

    if body.name is not None:
        class_.name = body.name.strip()
    if body.teacher_id is not None:
        teacher = db.query(User).filter(User.id == body.teacher_id, User.role == UserRole.teacher).first()
        if not teacher:
            raise HTTPException(404, "Teacher not found")
        class_.teacher_id = body.teacher_id

    db.commit()
    db.refresh(class_)
    return _serialize_class(class_, db)


@router.post("/classes/{class_id}/students", response_model=AdminClassResponse)
def add_student_to_class(
    class_id: int,
    body: AdminClassStudentAdd,
    current_user: User = Depends(require_role(UserRole.admin)),
    db: Session = Depends(get_db),
):
    class_ = db.query(Class).filter(Class.id == class_id).first()
    if not class_:
        raise HTTPException(404, "Class not found")

    student = db.query(User).filter(User.id == body.student_id, User.role == UserRole.student).first()
    if not student:
        raise HTTPException(404, "Student not found")

    existing = db.query(ClassMembership).filter(ClassMembership.student_id == body.student_id).first()
    if existing:
        existing.class_id = class_id
    else:
        db.add(ClassMembership(student_id=body.student_id, class_id=class_id))
    db.commit()
    return _serialize_class(class_, db)


@router.delete("/classes/{class_id}/students/{student_id}", status_code=204)
def remove_student_from_class(
    class_id: int,
    student_id: int,
    current_user: User = Depends(require_role(UserRole.admin)),
    db: Session = Depends(get_db),
):
    membership = db.query(ClassMembership).filter(
        ClassMembership.class_id == class_id,
        ClassMembership.student_id == student_id,
    ).first()
    if not membership:
        raise HTTPException(404, "Student not found in class")
    db.delete(membership)
    db.commit()


@router.patch("/users/{user_id}", response_model=AdminStudentResponse)
def update_student_account(
    user_id: int,
    body: AdminUserUpdate,
    current_user: User = Depends(require_role(UserRole.admin)),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(
        User.id == user_id,
        User.role.in_([UserRole.student, UserRole.teacher]),
    ).first()
    if not user:
        raise HTTPException(404, "User not found")

    if body.is_active is not None:
        user.is_active = body.is_active
    if body.grade is not None and user.role == UserRole.student:
        user.grade = body.grade
    if body.teacher_subject is not None and user.role == UserRole.teacher:
        user.teacher_subject = body.teacher_subject.strip() or None
    db.commit()
    db.refresh(user)

    if user.role == UserRole.teacher:
        return AdminStudentResponse(
            id=user.id,
            first_name=user.first_name,
            last_name=user.last_name,
            email=user.email,
            grade=user.teacher_subject,
            is_active=user.is_active,
            class_id=None,
            class_name="Учитель",
        )

    membership = db.query(ClassMembership).filter(ClassMembership.student_id == user.id).first()
    class_ = db.query(Class).filter(Class.id == membership.class_id).first() if membership else None
    return AdminStudentResponse(
        id=user.id,
        first_name=user.first_name,
        last_name=user.last_name,
        email=user.email,
        grade=user.grade,
        is_active=user.is_active,
        class_id=class_.id if class_ else None,
        class_name=class_.name if class_ else None,
    )


@router.get("/dashboard", response_model=AdminDashboardResponse)
def dashboard(
    current_user: User = Depends(require_role(UserRole.admin)),
    db: Session = Depends(get_db),
):
    classes = db.query(Class).order_by(Class.name.asc()).all()
    teachers = list_teachers(current_user=current_user, db=db)
    students = list_students(current_user=current_user, db=db)
    return AdminDashboardResponse(
        teachers_count=len(teachers),
        students_count=len(students),
        classes_count=len(classes),
        invite_codes_count=db.query(InviteCode).count(),
        classes=[_serialize_class(class_, db) for class_ in classes],
        teachers=teachers,
        students=students,
    )
