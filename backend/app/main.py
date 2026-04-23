import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from app.database import create_tables
from app.routers import users, admin, classes, assignments, tasks, grades, schedule, ai, notifications
from app.routers.notifications import start_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_tables()
    start_scheduler()
    yield


app = FastAPI(title="Vector API", lifespan=lifespan)

current_dir = os.path.dirname(os.path.abspath(__file__))
frontend_path = os.path.abspath(os.path.join(current_dir, "../../frontend"))

if os.path.exists(frontend_path):
    app.mount("/static", StaticFiles(directory=frontend_path), name="static")

origins = [
    "http://localhost:3000",
    "http://localhost:8000",
    "http://localhost:8080",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:8000",
    "http://127.0.0.1:8080",
    "http://vkcollege.ru",
    "https://vkcollege.ru",
    "null",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(users.router)
app.include_router(admin.router)
app.include_router(classes.router)
app.include_router(assignments.router)
app.include_router(tasks.router)
app.include_router(grades.router)
app.include_router(schedule.router)
app.include_router(ai.router)
app.include_router(notifications.router)


def serve(relative_path: str) -> FileResponse:
    return FileResponse(os.path.join(frontend_path, relative_path))


# Public pages
@app.get("/")
async def index():
    return serve("index.html")

@app.get("/login")
async def login_page():
    return serve("login.html")

@app.get("/register")
async def register_page():
    return serve("register.html")

@app.get("/verify")
async def verify_page():
    return serve("verify.html")

@app.get("/reset-password")
async def reset_password_page():
    return serve("reset-password.html")

@app.get("/reset-password-new")
async def reset_password_new_page():
    return serve("reset-password-new.html")


# Student pages
@app.get("/dashboard")
@app.get("/student/dashboard")
async def student_dashboard():
    return serve("student/dashboard.html")

@app.get("/student/tasks")
async def student_tasks():
    return serve("student/tasks.html")

@app.get("/student/calendar")
async def student_calendar():
    return serve("student/calendar.html")

@app.get("/student/ai")
async def student_ai():
    return serve("student/ai.html")

@app.get("/student/profile")
async def student_profile():
    return serve("student/profile.html")


# Teacher pages
@app.get("/teacher/dashboard")
async def teacher_dashboard():
    return serve("teacher/dashboard.html")

@app.get("/teacher/classes")
async def teacher_classes():
    return serve("teacher/classes.html")

@app.get("/teacher/classes/{class_id}")
async def teacher_class(class_id: int):
    return serve("teacher/class.html")

@app.get("/teacher/assignments")
async def teacher_assignments():
    return serve("teacher/assignments.html")

@app.get("/teacher/assignments/new")
async def teacher_assignment_new():
    return serve("teacher/assignment-new.html")

@app.get("/teacher/profile")
async def teacher_profile():
    return serve("teacher/profile.html")


# Parent pages
@app.get("/parent/dashboard")
async def parent_dashboard():
    return serve("parent/dashboard.html")

@app.get("/parent/child/{student_id}")
async def parent_child(student_id: int):
    return serve("parent/child.html")

@app.get("/parent/notifications")
async def parent_notifications():
    return serve("parent/notifications.html")

@app.get("/parent/profile")
async def parent_profile():
    return serve("parent/profile.html")


# Common
@app.get("/settings")
async def settings_page():
    return serve("settings.html")

@app.get("/health")
def health():
    return {"status": "ok"}

@app.exception_handler(404)
async def page_not_found(request: Request, exc: Exception):
    path_404 = os.path.join(frontend_path, "404.html")
    if os.path.exists(path_404):
        return FileResponse(path_404, status_code=404)
    return HTMLResponse("<h1>404</h1>", status_code=404)