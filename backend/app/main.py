import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from app.database import create_tables
from app.routers import users, admin, classes, assignments, tasks, grades, schedule, ai, notifications
from app.routers.notifications import start_scheduler
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
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
    "http://localhost:8080",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:8080",
    "http://vkcollege.ru",
    "https://vkcollege.ru",
    "null",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
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

@app.exception_handler(404)
async def page_not_found(request: Request, exc: Exception):
    path_404 = os.path.join(frontend_path, "404.html")
    
    if os.path.exists(path_404):
        return FileResponse(path_404, status_code=404)
    
    return HTMLResponse(content="<h1>404: Страница не найдена</h1>", status_code=404)

@app.get("/login")
async def server_login():
    login_path = os.path.join(frontend_path, "login.html")
    return FileResponse(login_path)

@app.get("/register")
async def server_register():
    login_path = os.path.join(frontend_path, "register.html")
    return FileResponse(login_path)

@app.get("/verify")
async def server_verify():
    login_path = os.path.join(frontend_path, "verify.html")
    return FileResponse(login_path)
    
@app.get("/dashboard")
async def server_dashboard():
    login_path = os.path.join(frontend_path, "dashboard.html")
    return FileResponse(login_path)

@app.get("/health")
def health():
    return {"status": "ok"}