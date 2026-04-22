# Vector
ollama: "qwen2.5:7b"

Запуск:
  1. Скачать репозиторий
  2. cd backend
    python3 -m venv .venv
    source .venv/bin/activate
    pip install -r requirements.txt
    cp ../.env.example ../.env
    uvicorn app.main:app --reload --port 8000
