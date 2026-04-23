from datetime import datetime, timedelta, timezone
from random import randint
import secrets

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from jose import JWTError, jwt
from passlib.context import CryptContext

from app.database import get_db
from app.models import User, UserRole, InviteCode, EmailVerification, ParentStudent, ParentLinkToken, PasswordResetToken
from app.config import settings

router = APIRouter(prefix="/api/users", tags=["users"])

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/users/login")


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    first_name: str
    last_name: str
    role: UserRole
    invite_code: str | None = None


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: UserRole
    first_name: str
    last_name: str


class VerifyEmailRequest(BaseModel):
    code: str


class ProfileResponse(BaseModel):
    id: int
    email: str
    first_name: str
    last_name: str
    role: UserRole
    grade: str | None
    avatar_url: str | None
    notify_email: bool
    notify_browser: bool
    notify_telegram: bool
    notify_digest_time: str

    class Config:
        from_attributes = True


class ProfileUpdateRequest(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    grade: str | None = None
    notify_email: bool | None = None
    notify_browser: bool | None = None
    notify_digest_time: str | None = None


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    return jwt.encode({"sub": str(user_id), "exp": expire}, settings.secret_key, algorithm=settings.algorithm)


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    exc = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        user_id = int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        raise exc
    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.is_active:
        raise exc
    return user


def require_role(*roles: UserRole):
    def dependency(current_user: User = Depends(get_current_user)):
        if current_user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
        return current_user
    return dependency


# ---------------------------------------------------------------------------
# Email verification helper (без SMTP пока — заглушка, добавим в notifications)
# ---------------------------------------------------------------------------

def _send_verification_email(email: str, code: str):
    # TODO: заменить на реальный SMTP в notifications.py
    print(f"[DEV] Verification code for {email}: {code}")


def _create_verification(user_id: int, db: Session) -> str:
    code = str(randint(100000, 999999))
    expires = datetime.now(timezone.utc) + timedelta(minutes=15)
    db.add(EmailVerification(user_id=user_id, code=code, expires_at=expires))
    db.commit()
    return code


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/register", status_code=201)
def register(body: RegisterRequest, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == body.email).first():
        raise HTTPException(400, "Email already registered")

    if body.role == UserRole.teacher:
        if not body.invite_code:
            raise HTTPException(400, "Invite code required for teacher registration")
        invite = db.query(InviteCode).filter(
            InviteCode.code == body.invite_code,
            InviteCode.is_used == False
        ).first()
        if not invite:
            raise HTTPException(400, "Invalid or already used invite code")

    if len(body.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")

    user = User(
        email=body.email,
        password_hash=hash_password(body.password),
        first_name=body.first_name,
        last_name=body.last_name,
        role=body.role,
        is_active=False,
        is_verified=False,
    )
    db.add(user)
    db.flush()  # получаем user.id до commit

    if body.role == UserRole.teacher:
        invite.is_used = True
        invite.used_by_id = user.id
        invite.used_at = datetime.now(timezone.utc)

    code = _create_verification(user.id, db)
    _send_verification_email(user.email, code)
    db.commit()

    return {"message": "Registration successful. Check your email for verification code."}


@router.post("/verify-email")
def verify_email(body: VerifyEmailRequest, db: Session = Depends(get_db)):
    record = db.query(EmailVerification).filter(
        EmailVerification.code == body.code,
        EmailVerification.is_used == False,
    ).order_by(EmailVerification.created_at.desc()).first()

    if not record:
        raise HTTPException(400, "Invalid code")
    if record.expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        raise HTTPException(400, "Code expired")

    record.is_used = True
    user = db.query(User).filter(User.id == record.user_id).first()
    user.is_active = True
    user.is_verified = True
    db.commit()

    return {"message": "Email verified. You can now log in."}


@router.post("/resend-verification")
def resend_verification(email: EmailStr, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == email, User.is_verified == False).first()
    if not user:
        raise HTTPException(400, "User not found or already verified")
    code = _create_verification(user.id, db)
    _send_verification_email(user.email, code)
    return {"message": "Code sent"}


@router.post("/login", response_model=LoginResponse)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == form.username).first()
    if not user or not verify_password(form.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Email not verified")
    return LoginResponse(
        access_token=create_access_token(user.id),
        role=user.role,
        first_name=user.first_name,
        last_name=user.last_name,
    )


@router.get("/me", response_model=ProfileResponse)
def get_profile(current_user: User = Depends(get_current_user)):
    return current_user


@router.patch("/me", response_model=ProfileResponse)
def update_profile(
    body: ProfileUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(current_user, field, value)
    db.commit()
    db.refresh(current_user)
    return current_user


@router.post("/me/change-password")
def change_password(
    body: PasswordChangeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(body.current_password, current_user.password_hash):
        raise HTTPException(400, "Wrong current password")
    if len(body.new_password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    current_user.password_hash = hash_password(body.new_password)
    db.commit()
    return {"message": "Password changed"}


@router.post("/me/parent-link-token")
def generate_parent_link_token(
    current_user: User = Depends(require_role(UserRole.student)),
    db: Session = Depends(get_db),
):
    """Ученик генерирует 6-значный код. Родитель вводит его у себя в кабинете."""
    existing = db.query(ParentLinkToken).filter(
        ParentLinkToken.student_id == current_user.id,
        ParentLinkToken.is_used == False,
        ParentLinkToken.expires_at > datetime.now(timezone.utc),
    ).first()
    if existing:
        return {"code": existing.code, "expires_at": existing.expires_at}

    code = str(randint(100000, 999999))
    expires = datetime.now(timezone.utc) + timedelta(hours=24)
    token = ParentLinkToken(student_id=current_user.id, code=code, expires_at=expires)
    db.add(token)
    db.commit()
    return {"code": code, "expires_at": expires}


@router.post("/me/link-parent")
def link_parent(
    code: str,
    current_user: User = Depends(require_role(UserRole.parent)),
    db: Session = Depends(get_db),
):
    """Родитель вводит код из кабинета ученика и привязывается к нему."""
    token = db.query(ParentLinkToken).filter(
        ParentLinkToken.code == code,
        ParentLinkToken.is_used == False,
        ParentLinkToken.expires_at > datetime.now(timezone.utc),
    ).first()
    if not token:
        raise HTTPException(400, "Invalid or expired code")

    already = db.query(ParentStudent).filter(
        ParentStudent.parent_id == current_user.id,
        ParentStudent.student_id == token.student_id,
    ).first()
    if already:
        raise HTTPException(400, "Already linked")

    db.add(ParentStudent(parent_id=current_user.id, student_id=token.student_id))
    token.is_used = True
    db.commit()

    student = db.query(User).filter(User.id == token.student_id).first()
    return {"message": "Linked successfully", "student_name": f"{student.first_name} {student.last_name}"}


@router.get("/me/children")
def get_children(
    current_user: User = Depends(require_role(UserRole.parent)),
    db: Session = Depends(get_db),
):
    links = db.query(ParentStudent).filter(ParentStudent.parent_id == current_user.id).all()
    result = []
    for link in links:
        s = db.query(User).filter(User.id == link.student_id).first()
        if s:
            result.append({"id": s.id, "first_name": s.first_name, "last_name": s.last_name, "email": s.email, "grade": s.grade})
    return result


# ---------------------------------------------------------------------------
# Password reset
# ---------------------------------------------------------------------------

class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirm(BaseModel):
    token: str
    new_password: str


@router.post("/password-reset/request")
def request_password_reset(body: PasswordResetRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email).first()
    if not user:
        return {"message": "Если такой email зарегистрирован, письмо отправлено."}

    db.query(PasswordResetToken).filter(
        PasswordResetToken.user_id == user.id,
        PasswordResetToken.is_used == False,
    ).update({"is_used": True})

    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(hours=1)
    db.add(PasswordResetToken(user_id=user.id, token=token, expires_at=expires))
    db.commit()

    reset_link = f"{settings.app_url}/reset-password-new?token={token}"
    # TODO: заменить print на реальный SMTP после подключения notifications
    print(f"[DEV] Password reset link for {user.email}: {reset_link}")

    return {"message": "Если такой email зарегистрирован, письмо отправлено.", "dev_link": reset_link}


@router.post("/password-reset/confirm")
def confirm_password_reset(body: PasswordResetConfirm, db: Session = Depends(get_db)):
    if len(body.new_password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")

    record = db.query(PasswordResetToken).filter(
        PasswordResetToken.token == body.token,
        PasswordResetToken.is_used == False,
        PasswordResetToken.expires_at > datetime.now(timezone.utc),
    ).first()

    if not record:
        raise HTTPException(400, "Invalid or expired reset link")

    user = db.query(User).filter(User.id == record.user_id).first()
    user.password_hash = hash_password(body.new_password)
    record.is_used = True
    db.commit()

    return {"message": "Password changed successfully"}
