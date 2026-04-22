import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
import httpx

from app.database import get_db
from app.models import AIMessage, Task, Schedule, User, UserRole, TaskPriority, TaskStatus
from app.routers.users import require_role
from app.routers.notifications import create_notification
from app.models import NotificationChannel
from app.config import settings

router = APIRouter(prefix="/api/ai", tags=["ai"])

QUICK_PROMPTS = [
    "Помоги распланировать неделю",
    "Что срочнее всего сделать?",
    "Разбей большое задание на шаги",
    "Когда лучше сесть за уроки сегодня?",
]


SYSTEM_PROMPT = """Ты — учебный ассистент для школьника. Твоя роль: помогать планировать учёбу, расставлять приоритеты и напоминать о заданиях.

СТРОГИЕ ЗАПРЕТЫ:
- Никогда не решай задания, уравнения, задачи
- Никогда не пиши сочинения, эссе, рефераты
- Никогда не давай готовые ответы на учебные вопросы
- Если просят решить — вежливо откажи и предложи помощь с планированием

ТЫ УМЕЕШЬ:
- Анализировать список задач и расставлять приоритеты
- Разбивать большие задания на конкретные шаги
- Предлагать оптимальное время для работы с учётом расписания
- Мотивировать и поддерживать
- Напоминать о дедлайнах

При ответе учитывай контекст задач и расписания который тебе передан.
Отвечай на том же языке что и пользователь. Будь лаконичен."""

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

    tasks = db.query(Task).filter(
        Task.student_id == student_id,
        Task.status != TaskStatus.done,
        Task.parent_task_id == None,
    ).order_by(Task.deadline.asc().nullslast()).limit(20).all()

    schedule = db.query(Schedule).filter(Schedule.student_id == student_id).order_by(
        Schedule.weekday, Schedule.start_time
    ).all()

    weekdays = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"]

    ctx_parts = [f"Сегодня: {now.strftime('%A, %d.%m.%Y %H:%M')}"]

    if tasks:
        ctx_parts.append("\nАктивные задачи:")
        for t in tasks:
            deadline_str = t.deadline.strftime("%d.%m %H:%M") if t.deadline else "без дедлайна"
            overdue = " [ПРОСРОЧЕНО]" if t.deadline and t.deadline < now else ""
            ctx_parts.append(
                f"- [{t.priority.value}] {t.subject or ''}: {t.title} | дедлайн: {deadline_str}{overdue}"
            )
    else:
        ctx_parts.append("\nАктивных задач нет.")

    if schedule:
        ctx_parts.append("\nРасписание:")
        for s in schedule:
            ctx_parts.append(f"- {weekdays[s.weekday]} {s.start_time}-{s.end_time}: {s.subject}")

    return "\n".join(ctx_parts)


def _get_history(user_id: int, db: Session, limit: int = 10) -> list[dict]:
    messages = db.query(AIMessage).filter(
        AIMessage.user_id == user_id
    ).order_by(AIMessage.created_at.desc()).limit(limit).all()

    return [{"role": m.role, "content": m.content} for m in reversed(messages)]


async def _call_ollama(messages: list[dict]) -> str:
    payload = {
        "model": settings.ollama_model,
        "messages": messages,
        "stream": False,
    }
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{settings.ollama_url}/api/chat",
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
            return data["message"]["content"]
    except httpx.ConnectError:
        raise HTTPException(503, "AI service unavailable")
    except Exception as e:
        raise HTTPException(500, f"AI error: {str(e)}")


def _detect_action(reply: str, user_message: str) -> tuple[str | None, dict | None]:
    lower = user_message.lower()
    if any(w in lower for w in ["разбей", "раздели", "по шагам", "подзадачи"]):
        if any(c in reply for c in ["1.", "2.", "•", "-"]):
            return "create_subtasks", {"hint": "Хочешь сохранить эти шаги как подзадачи?"}
    return None, None


@router.get("/quick-prompts")
def quick_prompts():
    return {"prompts": QUICK_PROMPTS}


@router.get("/history", response_model=list[MessageResponse])
def get_history(
    current_user: User = Depends(require_role(UserRole.student)),
    db: Session = Depends(get_db),
):
    return db.query(AIMessage).filter(
        AIMessage.user_id == current_user.id
    ).order_by(AIMessage.created_at.asc()).limit(100).all()


@router.post("/chat", response_model=ChatResponse)
async def chat(
    body: ChatRequest,
    current_user: User = Depends(require_role(UserRole.student)),
    db: Session = Depends(get_db),
):
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
    task = db.query(Task).filter(
        Task.id == task_id,
        Task.student_id == current_user.id,
    ).first()
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
        title=f"Задача разбита на шаги",
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
