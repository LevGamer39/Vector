import os
import sqlite3

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.models import Base, User, UserRole

os.makedirs(os.path.dirname(settings.db_path), exist_ok=True)

DATABASE_URL = f"sqlite:///{settings.db_path}"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False, "timeout": 30},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _column_names(connection, table_name: str) -> set[str]:
    rows = connection.execute(text(f"PRAGMA table_info({table_name})")).fetchall()
    return {row[1] for row in rows}


def _migrate_sqlite_schema() -> None:
    with engine.begin() as connection:
        connection.execute(text("PRAGMA journal_mode=WAL"))
        connection.execute(text("PRAGMA foreign_keys=ON"))
        connection.execute(text("PRAGMA busy_timeout=30000"))

        user_columns = _column_names(connection, "users")
        if "teacher_subject" not in user_columns:
            connection.execute(text("ALTER TABLE users ADD COLUMN teacher_subject VARCHAR(100)"))
        if "teacher_invite_code" not in user_columns:
            connection.execute(text("ALTER TABLE users ADD COLUMN teacher_invite_code VARCHAR(16)"))
        if "notify_email" not in user_columns:
            connection.execute(text("ALTER TABLE users ADD COLUMN notify_email BOOLEAN DEFAULT 1"))
        if "notify_browser" not in user_columns:
            connection.execute(text("ALTER TABLE users ADD COLUMN notify_browser BOOLEAN DEFAULT 1"))
        if "notify_telegram" not in user_columns:
            connection.execute(text("ALTER TABLE users ADD COLUMN notify_telegram BOOLEAN DEFAULT 0"))
        if "notify_digest_time" not in user_columns:
            connection.execute(text("ALTER TABLE users ADD COLUMN notify_digest_time VARCHAR(5) DEFAULT '08:00'"))

        class_columns = _column_names(connection, "classes")
        if "subject" not in class_columns:
            connection.execute(text("ALTER TABLE classes ADD COLUMN subject VARCHAR(100)"))

        connection.execute(text("UPDATE users SET notify_email = COALESCE(notify_email, 1)"))
        connection.execute(text("UPDATE users SET notify_browser = COALESCE(notify_browser, 1)"))
        connection.execute(text("UPDATE users SET notify_telegram = COALESCE(notify_telegram, 0)"))
        connection.execute(text("UPDATE users SET notify_digest_time = COALESCE(notify_digest_time, '08:00')"))


def _ensure_admin_user() -> None:
    from app.routers.users import hash_password

    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.role == UserRole.admin).first()
        if admin:
            changed = False
            if not admin.is_active:
                admin.is_active = True
                changed = True
            if not admin.is_verified:
                admin.is_verified = True
                changed = True
            if changed:
                db.commit()
            return

        db.add(
            User(
                email=settings.admin_email,
                password_hash=hash_password(settings.admin_password),
                first_name=settings.admin_first_name,
                last_name=settings.admin_last_name,
                role=UserRole.admin,
                is_active=True,
                is_verified=True,
                notify_email=True,
                notify_browser=True,
                notify_telegram=False,
                notify_digest_time="08:00",
            )
        )
        db.commit()
    finally:
        db.close()


def create_tables():
    Base.metadata.create_all(bind=engine)
    _migrate_sqlite_schema()
    _ensure_admin_user()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
