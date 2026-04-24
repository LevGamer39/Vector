import json
import re
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import (
    AIMessage,
    NotificationChannel,
    Schedule,
    Task,
    TaskPriority,
    TaskStatus,
    User,
    UserRole,
)
from app.routers.notifications import create_notification
from app.routers.users import require_role

router = APIRouter(prefix="/api/ai", tags=["ai"])

QUICK_PROMPTS = [
    "Помоги распланировать неделю",
    "Что срочнее всего сделать?",
    "Разбей большое задание на шаги",
    "Когда лучше сесть за уроки сегодня?",
]

WEEKDAY_MAP = {
    "понедельник": 0,
    "вторник": 1,
    "среда": 2,
    "среду": 2,
    "четверг": 3,
    "пятница": 4,
    "суббота": 5,
    "воскресенье": 6,
}

SYSTEM_PROMPT = """Ты — учебный ассистент для школьника.
Твоя задача: помогать с планированием учебы, приоритетами, дедлайнами и разбиением задач на шаги.

Строгие ограничения:
- Никогда не решай учебные задания за ученика.
- Никогда не пиши готовые сочинения, эссе и рефераты.
- Если просят решить задачу, вежливо откажись и предложи помочь с планом, объяснением или разбиением на шаги.

Что ты умеешь:
- анализировать список задач и расставлять приоритеты;
- разбивать большие задания на конкретные шаги;
- предлагать удобное время для учебы с учетом расписания;
- кратко и понятно мотивировать.

Отвечай на языке пользователя. Будь лаконичен и практичен."""


class ChatRequest(BaseModel):
    message: str


class ChatResponse(BaseModel):
    reply: str
    action: str | None = None
    data: dict | None = None


class MessageResponse(BaseModel):
    id: int
    role: str
    content: str
    created_at: datetime

    class Config:
        from_attributes = True


def _build_context(student_id: int, db: Session) -> str:
    now = datetime.now(timezone.utc)

    tasks = (
        db.query(Task)
        .filter(
            Task.student_id == student_id,
            Task.status != TaskStatus.done,
            Task.parent_task_id == None,
        )
        .order_by(Task.deadline.asc().nullslast())
        .limit(20)
        .all()
    )

    schedule = (
        db.query(Schedule)
        .filter(Schedule.student_id == student_id)
        .order_by(Schedule.weekday, Schedule.start_time)
        .all()
    )

    weekdays = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"]
    parts = [f"Сегодня: {now.strftime('%d.%m.%Y %H:%M')}"]

    if tasks:
        parts.append("\nАктивные задачи:")
        for task in tasks:
            deadline_str = task.deadline.strftime("%d.%m %H:%M") if task.deadline else "без дедлайна"
            overdue = " [ПРОСРОЧЕНО]" if task.deadline and task.deadline.replace(tzinfo=timezone.utc) < now else ""
            parts.append(
                f"- [{task.priority.value}] {task.subject or 'Общее'}: {task.title} | дедлайн: {deadline_str}{overdue}"
            )
    else:
        parts.append("\nАктивных задач нет.")

    if schedule:
        parts.append("\nРасписание:")
        for item in schedule:
            parts.append(f"- {weekdays[item.weekday]} {item.start_time}-{item.end_time}: {item.subject}")

    return "\n".join(parts)


def _get_history(user_id: int, db: Session, limit: int = 10) -> list[dict]:
    messages = (
        db.query(AIMessage)
        .filter(AIMessage.user_id == user_id)
        .order_by(AIMessage.created_at.desc())
        .limit(limit)
        .all()
    )
    return [{"role": msg.role, "content": msg.content} for msg in reversed(messages)]


async def _call_ollama(messages: list[dict]) -> str:
    payload = {
        "model": settings.ollama_model,
        "messages": messages,
        "stream": False,
    }
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(f"{settings.ollama_url}/api/chat", json=payload)
            response.raise_for_status()
            data = response.json()
            return data["message"]["content"]
    except httpx.ConnectError:
        raise HTTPException(503, "AI service unavailable")
    except Exception as exc:
        raise HTTPException(500, f"AI error: {str(exc)}")


def _detect_action(reply: str, user_message: str) -> tuple[str | None, dict | None]:
    lower = user_message.lower()
    if any(word in lower for word in ["разбей", "раздели", "по шагам", "подзадачи"]):
        if any(char in reply for char in ["1.", "2.", "•", "-"]):
            return "create_subtasks", {"hint": "Хочешь сохранить эти шаги как подзадачи?"}
    return None, None


def _looks_like_task_create_intent(message: str) -> bool:
    lower = message.lower()
    create_words = ["добавь", "создай", "запиши", "поставь"]
    task_words = ["задач", "дело", "напомин", "план"]
    return any(word in lower for word in create_words) and any(word in lower for word in task_words)


def _default_priority_from_text(text: str) -> TaskPriority:
    lower = text.lower()
    if any(word in lower for word in ["срочно", "сегодня", "до вечера", "сейчас"]):
        return TaskPriority.critical
    if any(word in lower for word in ["егэ", "экзам", "контрольн", "олимпиад", "проект", "сдать"]):
        return TaskPriority.high
    if any(word in lower for word in ["подготов", "домаш", "урок", "презентац", "повторить"]):
        return TaskPriority.medium
    return TaskPriority.medium


def _fallback_task_title(text: str) -> str:
    cleaned = text.strip()
    cleaned = re.sub(r"^(пожалуйста[:,]?\s*)", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"^(добавь|создай|запиши|поставь)\s+(мне\s+)?(задачу|дело|напоминание)\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"^(на\s+(сегодня|завтра|послезавтра)\s*)", "", cleaned, flags=re.IGNORECASE)
    return cleaned.strip(" .,:;-") or "Новая задача"


def _parse_deadline_hint(deadline_hint: str | None, user_message: str) -> datetime | None:
    source = f"{deadline_hint or ''} {user_message}".strip().lower()
    if not source:
        return None

    now = datetime.now(timezone.utc)
    base_date = now.date()

    if "послезавтра" in source:
        base_date = (now + timedelta(days=2)).date()
    elif "завтра" in source:
        base_date = (now + timedelta(days=1)).date()
    elif "сегодня" in source:
        base_date = now.date()
    else:
        match = re.search(r"\b(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?\b", source)
        if match:
            day = int(match.group(1))
            month = int(match.group(2))
            year_raw = match.group(3)
            year = int(year_raw) if year_raw else now.year
            if year < 100:
                year += 2000
            try:
                base_date = datetime(year, month, day, tzinfo=timezone.utc).date()
            except ValueError:
                base_date = now.date()
        else:
            for weekday_name, weekday_number in WEEKDAY_MAP.items():
                if weekday_name in source:
                    diff = (weekday_number - now.weekday()) % 7
                    if diff == 0:
                        diff = 7
                    base_date = (now + timedelta(days=diff)).date()
                    break

    time_match = re.search(r"\b([01]?\d|2[0-3]):([0-5]\d)\b", source)
    hour = int(time_match.group(1)) if time_match else 18
    minute = int(time_match.group(2)) if time_match else 0
    return datetime(base_date.year, base_date.month, base_date.day, hour, minute, tzinfo=timezone.utc)


async def _extract_task_payload(user_message: str, context: str) -> dict:
    prompt = (
        "Извлеки из сообщения ученика данные для создания личной задачи. "
        'Ответь строго JSON без пояснений в формате {"title":"...", "subject":null, "description":null, "deadline_hint":null, "priority":"low|medium|high|critical"}. '
        "Если предмет не указан, оставь null. Если срока нет, оставь null. "
        "Приоритет выбери сам по важности задачи.\n\n"
        f"Контекст ученика:\n{context}\n\n"
        f"Сообщение ученика:\n{user_message}"
    )

    try:
        raw = await _call_ollama(
            [
                {"role": "system", "content": "Ты извлекаешь структуру задачи. Отвечай только валидным JSON."},
                {"role": "user", "content": prompt},
            ]
        )
        raw_clean = raw.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
        data = json.loads(raw_clean)
        if not isinstance(data, dict):
            raise ValueError
    except Exception:
        data = {}

    title = (data.get("title") or _fallback_task_title(user_message)).strip()
    subject = data.get("subject")
    description = data.get("description")
    deadline_hint = data.get("deadline_hint")
    priority_raw = str(data.get("priority") or _default_priority_from_text(user_message).value).lower()

    try:
        priority = TaskPriority(priority_raw)
    except ValueError:
        priority = _default_priority_from_text(user_message)

    return {
        "title": title or "Новая задача",
        "subject": subject.strip() if isinstance(subject, str) and subject.strip() else None,
        "description": description.strip() if isinstance(description, str) and description.strip() else None,
        "deadline": _parse_deadline_hint(deadline_hint, user_message),
        "priority": priority,
    }


def _format_priority(priority: TaskPriority) -> str:
    return {
        TaskPriority.low: "обычный",
        TaskPriority.medium: "важный",
        TaskPriority.high: "высокий",
        TaskPriority.critical: "критичный",
    }[priority]


def _format_deadline(deadline: datetime | None) -> str:
    if not deadline:
        return "без срока"
    return deadline.astimezone(timezone.utc).strftime("%d.%m, %H:%M")


async def _handle_task_creation(body: ChatRequest, current_user: User, db: Session) -> ChatResponse | None:
    if not _looks_like_task_create_intent(body.message):
        return None

    context = _build_context(current_user.id, db)
    payload = await _extract_task_payload(body.message, context)
    title = payload["title"].strip()

    if not title:
        reply = "Не смог понять название задачи. Напиши, что именно нужно добавить."
        db.add(AIMessage(user_id=current_user.id, role="user", content=body.message))
        db.add(AIMessage(user_id=current_user.id, role="assistant", content=reply))
        db.commit()
        return ChatResponse(reply=reply)

    task = Task(
        student_id=current_user.id,
        title=title,
        subject=payload["subject"],
        description=payload["description"],
        deadline=payload["deadline"],
        priority=payload["priority"],
        is_personal=True,
    )
    db.add(task)
    db.flush()

    deadline_text = _format_deadline(task.deadline)
    priority_text = _format_priority(task.priority)
    reply = f'Добавил задачу "{task.title}". Срок: {deadline_text}. Приоритет: {priority_text}.'

    db.add(AIMessage(user_id=current_user.id, role="user", content=body.message))
    db.add(AIMessage(user_id=current_user.id, role="assistant", content=reply))
    create_notification(
        db=db,
        user_id=current_user.id,
        title="Новая задача добавлена ИИ",
        body=f'Задача "{task.title}" создана с приоритетом "{priority_text}".',
        channel=NotificationChannel.browser,
    )
    db.commit()

    return ChatResponse(
        reply=reply,
        action="task_created",
        data={
            "task_id": task.id,
            "title": task.title,
            "deadline": task.deadline.isoformat() if task.deadline else None,
            "priority": task.priority.value,
        },
    )


@router.get("/quick-prompts")
def quick_prompts():
    return {"prompts": QUICK_PROMPTS}


@router.get("/history", response_model=list[MessageResponse])
def get_history(
    current_user: User = Depends(require_role(UserRole.student)),
    db: Session = Depends(get_db),
):
    return (
        db.query(AIMessage)
        .filter(AIMessage.user_id == current_user.id)
        .order_by(AIMessage.created_at.asc())
        .limit(100)
        .all()
    )


@router.post("/chat", response_model=ChatResponse)
async def chat(
    body: ChatRequest,
    current_user: User = Depends(require_role(UserRole.student)),
    db: Session = Depends(get_db),
):
    task_creation_response = await _handle_task_creation(body, current_user, db)
    if task_creation_response:
        return task_creation_response

    context = _build_context(current_user.id, db)
    history = _get_history(current_user.id, db)

    messages = [
        {"role": "system", "content": f"{SYSTEM_PROMPT}\n\nКонтекст ученика:\n{context}"},
        *history,
        {"role": "user", "content": body.message},
    ]

    reply = await _call_ollama(messages)

    db.add(AIMessage(user_id=current_user.id, role="user", content=body.message))
    db.add(AIMessage(user_id=current_user.id, role="assistant", content=reply))
    db.commit()

    action, data = _detect_action(reply, body.message)
    return ChatResponse(reply=reply, action=action, data=data)


@router.post("/analyze-load")
async def analyze_load(
    current_user: User = Depends(require_role(UserRole.student)),
    db: Session = Depends(get_db),
):
    context = _build_context(current_user.id, db)
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"Проанализируй мою нагрузку и дай краткие рекомендации:\n{context}"},
    ]
    reply = await _call_ollama(messages)
    return {"analysis": reply}


@router.post("/subtasks/{task_id}")
async def create_subtasks(
    task_id: int,
    current_user: User = Depends(require_role(UserRole.student)),
    db: Session = Depends(get_db),
):
    task = (
        db.query(Task)
        .filter(Task.id == task_id, Task.student_id == current_user.id)
        .first()
    )
    if not task:
        raise HTTPException(404, "Task not found")

    deadline_str = task.deadline.strftime("%d.%m.%Y") if task.deadline else "не указан"
    prompt = (
        f"Задача: {task.title}\n"
        f"Предмет: {task.subject or 'не указан'}\n"
        f"Описание: {task.description or 'нет'}\n"
        f"Дедлайн: {deadline_str}\n\n"
        f"Разбей эту задачу на 3-6 конкретных шагов. "
        f"Ответь строго в JSON без лишнего текста:\n"
        f'[{{"title": "шаг 1"}}, {{"title": "шаг 2"}}]'
    )

    messages = [
        {"role": "system", "content": "Ты помощник по планированию. Отвечай только JSON."},
        {"role": "user", "content": prompt},
    ]

    raw = await _call_ollama(messages)

    try:
        raw_clean = raw.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
        steps = json.loads(raw_clean)
        if not isinstance(steps, list):
            raise ValueError
    except (json.JSONDecodeError, ValueError):
        raise HTTPException(500, "AI returned invalid format")

    created = []
    for step in steps[:6]:
        title = step.get("title", "").strip()
        if not title:
            continue
        subtask = Task(
            student_id=current_user.id,
            parent_task_id=task.id,
            title=title,
            subject=task.subject,
            deadline=task.deadline,
            priority=task.priority,
            is_personal=task.is_personal,
            assignment_id=task.assignment_id,
        )
        db.add(subtask)
        created.append(title)

    create_notification(
        db=db,
        user_id=current_user.id,
        title="Задача разбита на шаги",
        body=f'"{task.title}" разделена на {len(created)} шагов.',
        channel=NotificationChannel.browser,
    )

    db.commit()
    return {"created": len(created), "subtasks": created}


@router.delete("/history", status_code=204)
def clear_history(
    current_user: User = Depends(require_role(UserRole.student)),
    db: Session = Depends(get_db),
):
    db.query(AIMessage).filter(AIMessage.user_id == current_user.id).delete()
    db.commit()
