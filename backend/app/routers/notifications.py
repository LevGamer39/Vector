import smtplib
import asyncio
from datetime import datetime, timezone
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.dependencies import get_current_user, require_role
from app.database import get_db, SessionLocal
from app.models import Notification, NotificationChannel, Task, TaskStatus, User, UserRole
from app.routers.users import get_current_user, require_role
from app.config import settings

router = APIRouter(prefix="/api/notifications", tags=["notifications"])
scheduler = AsyncIOScheduler()


class NotificationResponse(BaseModel):
    id: int
    title: str
    body: str
    channel: NotificationChannel
    is_read: bool
    is_sent: bool
    created_at: datetime

    class Config:
        from_attributes = True



def send_email(to: str, subject: str, body: str):
    if not settings.smtp_host:
        print(f"[DEV] Email to {to}: {subject}")
        return
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = settings.email_from
        msg["To"] = to
        msg.attach(MIMEText(body, "html", "utf-8"))

        with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
            server.starttls() # Уберите, если локальный порт 2525 не поддерживает TLS
            if settings.smtp_user and settings.smtp_password:
                server.login(settings.smtp_user, settings.smtp_password)
            server.sendmail(settings.email_from, to, msg.as_string())
    except Exception as e:
        print(f"[SMTP error] {e}")


def send_verification_email(to: str, code: str):
    subject = "Подтверждение email"
    body = f"<p>Ваш код подтверждения: <strong>{code}</strong></p><p>Код действителен 15 минут.</p>"
    send_email(to, subject, body)


def create_notification(
    db: Session,
    user_id: int,
    title: str,
    body: str,
    channel: NotificationChannel = NotificationChannel.browser,
    scheduled_at: datetime | None = None,
):
    n = Notification(
        user_id=user_id,
        title=title,
        body=body,
        channel=channel,
        scheduled_at=scheduled_at,
    )
    db.add(n)
    db.commit()
    return n



async def _job_send_pending_emails():
    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        pending = db.query(Notification).filter(
            Notification.channel == NotificationChannel.email,
            Notification.is_sent == False,
            (Notification.scheduled_at == None) | (Notification.scheduled_at <= now),
        ).all()

        for n in pending:
            user = db.query(User).filter(User.id == n.user_id).first()
            if user and user.notify_email:
                send_email(user.email, n.title, n.body)
            n.is_sent = True
            n.sent_at = now
        db.commit()
    finally:
        db.close()


async def _job_check_overdue():
    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        overdue = db.query(Task).filter(
            Task.deadline < now,
            Task.status == TaskStatus.pending,
        ).all()

        for task in overdue:
            task.status = TaskStatus.overdue
            create_notification(
                db=db,
                user_id=task.student_id,
                title="Просроченная задача",
                body=f'Задача "{task.title}" просрочена. Дедлайн был {task.deadline.strftime("%d.%m %H:%M")}.',
                channel=NotificationChannel.email,
            )
        db.commit()
    finally:
        db.close()


def start_scheduler():
    scheduler.add_job(_job_send_pending_emails, "interval", minutes=1, id="send_emails")
    scheduler.add_job(_job_check_overdue, "interval", minutes=10, id="check_overdue")
    scheduler.start()


@router.get("", response_model=list[NotificationResponse])
def list_notifications(
    unread_only: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(Notification).filter(Notification.user_id == current_user.id)
    if unread_only:
        query = query.filter(Notification.is_read == False)
    return query.order_by(Notification.created_at.desc()).limit(100).all()


@router.post("/{notification_id}/read", status_code=204)
def mark_read(
    notification_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    n = db.query(Notification).filter(
        Notification.id == notification_id,
        Notification.user_id == current_user.id,
    ).first()
    if not n:
        raise HTTPException(404, "Not found")
    n.is_read = True
    db.commit()


@router.post("/read-all", status_code=204)
def mark_all_read(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.query(Notification).filter(
        Notification.user_id == current_user.id,
        Notification.is_read == False,
    ).update({"is_read": True})
    db.commit()
