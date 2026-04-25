# Vector — Умный планировщик для школьников

Веб-приложение для управления учебными задачами с ИИ-ассистентом. Разработано для WATA.

---

## Стек

### Backend
| Технология | Назначение |
|---|---|
| **FastAPI** (Python) | REST API, маршрутизация, валидация |
| **SQLite3** + **SQLAlchemy** | База данных, ORM |
| **python-jose** + **passlib** | JWT-авторизация, хэширование паролей |
| **APScheduler** + **asyncio** | Фоновые задачи (проверка дедлайнов, очередь уведомлений) |
| **SMTP** | Email-уведомления |
| **httpx** | Асинхронные запросы к Ollama |

### AI
| Технология | Назначение |
|---|---|
| **Ollama** | Локальный LLM-сервер (Docker-контейнер) |
| **Qwen2.5:7b** | Языковая модель (планирование, приоритеты, разбивка задач) |

### Frontend
| Технология | Назначение |
|---|---|
| **HTML / CSS / JS** | Чистый фронтенд без фреймворков |
| **Canvas API** | Графики успеваемости |
| **LocalStorage** | Хранение JWT-токена и данных сессии |

### Планируется
- **Вк-бот** — второй способ входа и канал уведомлений

---
## Архитектура

```
Интернет
    │
    ▼ :80 / :443
┌─────────────────────────────┐
│         Сервер              │
│                             │
│  ┌─────────────────────┐    │
│  │  Docker: nginx      │    │  ← SSL termination, HTTP→HTTPS редирект
│  └────────┬────────────┘    │
│           │ proxy_pass      │
│  ┌────────▼────────────┐    │
│  │  Docker: backend    │    │  ← FastAPI (внутри сети, наружу не видна)
│  └────────┬────────────┘    │
│           │ http://ollama   │
│  ┌────────▼────────────┐    │
│  │  Docker: ollama     │    │  ← Qwen2.5:7b (внутри сети, наружу не видна)
│  └─────────────────────┘    │
│                             │
│  ┌─────────────────────┐    │
│  │  Docker: certbot    │    │  ← Автообновление сертификата каждые 12ч
│  └─────────────────────┘    │
└─────────────────────────────┘
```

Все контейнеры в одной Docker-сети `vector_net`. Наружу открыты только порты 80 и 443 через nginx.

---

## Структура проекта

```
project/
├── backend/
│   ├── app/
│   │   ├── main.py              # Точка входа FastAPI, все маршруты
│   │   ├── config.py            # Настройки из .env
│   │   ├── database.py          # SQLAlchemy engine, сессии
│   │   ├── models.py            # Все модели БД
│   │   ├── dependencies.py      # Функции которые требуют несколько сервисов одновременно
│   │   └── routers/
│   │       ├── admin.py         # Управление: пользователями, классами, кодами
│   │       ├── users.py         # Авторизация, JWT, профиль, сброс пароля
│   │       ├── admin.py         # Панель администратора, инвайт-коды
│   │       ├── classes.py       # Классы учителя, вступление учеников
│   │       ├── assignments.py   # Задания учителя
│   │       ├── tasks.py         # Задачи ученика
│   │       ├── grades.py        # Оценки
│   │       ├── schedule.py      # Расписание уроков
│   │       ├── ai.py            # Чат с Qwen, анализ нагрузки, подзадачи
│   │       ├── yandex_auth.py   # OAuth Яндекса
│   │       └── notifications.py # Уведомления, SMTP, APScheduler
│   ├── Dockerfile
│   └── requirements.txt
│
├── frontend/
│   ├── index.html               # Лендинг (публичный)
│   ├── login.html               # Вход
│   ├── register.html            # Регистрация (ученик / учитель / родитель)
│   ├── verify.html              # Подтверждение email (6-значный код)
│   ├── reset-password.html      # Запрос сброса пароля
│   ├── reset-password-new.html  # Ввод нового пароля по ссылке
│   ├── 404.html
│   ├── settings.html
│   ├── css/
│   │   └── base.css             # Общие стили внутренних страниц
│   ├── js/
│   │   └── api.js               # Общий fetch-хелпер, requireAuth()
│   ├── student/
│   │   ├── dashboard.html       # Дашборд ученика
│   │   ├── tasks.html           # Задачи
│   │   ├── calendar.html        # Календарь дедлайнов
│   │   ├── ai.html              # ИИ-ассистент
│   │   └── profile.html         # Профиль
│   └── teacher/
│       ├── dashboard.html
│       ├── classes.html
│       ├── class.html           # Страница класса /classes/:id
│       ├── assignments.html
│       └── assignment-new.html
│
├── .env                         # Переменные окружения (не в git)
├── .env.example                 # Шаблон
└── README.md
```

---

## Роли пользователей

| Роль | Возможности |
|---|---|
| **Ученик** | Задачи, календарь, ИИ-чат, расписание, оценки, профиль |
| **Учитель** | Создание заданий, управление классами, просмотр прогресса учеников, оценки |
| **Родитель** | Просмотр задач и оценок ребёнка (только чтение), уведомления |
| **Администратор** | Генерация инвайт-кодов для учителей |

---

## Деплой в Яндекс.Облаке

### Инфраструктура

```
Яндекс.Облако
    │
    ├── Yandex Compute Cloud (VM)
    │       ОС: Ubuntu 22.04 LTS
    │       vCPU: 4+  RAM: 8+ GB  (Qwen2.5:7b требует ~6 GB RAM)
    │       Диск: 40+ GB (модель весит ~5 GB)
    │
    ├── Yandex DNS
    │       A-запись: yourdomain.ru → IP виртуальной машины
    │
    └── Внешний IP (статический, привязан к VM)
```

### Docker Compose (все сервисы)

```yaml
# docker-compose.yml
version: "3.9"

networks:
  vector_net:
    driver: bridge

services:

  backend:
    build: ./backend
    container_name: vector_backend
    restart: unless-stopped
    env_file: .env
    volumes:
      - ./backend/data:/app/data
    networks:
      - vector_net
    depends_on:
      - ollama

  nginx:
    image: nginx:alpine
    container_name: vector_nginx
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./frontend:/usr/share/nginx/html:ro
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./certbot/conf:/etc/letsencrypt:ro
      - ./certbot/www:/var/www/certbot:ro
    networks:
      - vector_net
    depends_on:
      - backend

  ollama:
    image: ollama/ollama:latest
    container_name: vector_ollama
    restart: unless-stopped
    volumes:
      - ollama_data:/root/.ollama
    networks:
      - vector_net

  certbot:
    image: certbot/certbot:latest
    container_name: vector_certbot
    volumes:
      - ./certbot/conf:/etc/letsencrypt
      - ./certbot/www:/var/www/certbot
    entrypoint: >
      /bin/sh -c "trap exit TERM;
      while :; do
        certbot renew --webroot -w /var/www/certbot --quiet;
        sleep 12h;
      done"

volumes:
  ollama_data:
```

### nginx.conf

```nginx
# nginx/nginx.conf
events {}

http {
    include mime.types;

    server {
        listen 80;
        server_name yourdomain.ru;  # заменить на свой домен

        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }

        location / {
            return 301 https://$host$request_uri;
        }
    }

    server {
        listen 443 ssl;
        server_name yourdomain.ru;  # заменить на свой домен

        ssl_certificate /etc/letsencrypt/live/yourdomain.ru/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/yourdomain.ru/privkey.pem;

        root /usr/share/nginx/html;
        index index.html;

        location /api/ {
            proxy_pass http://backend:8000;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }

        location / {
            try_files $uri $uri/ /index.html;
        }
    }
}
```

### Первичный запуск на сервере

```bash
# 1. Установить Docker
curl -fsSL https://get.docker.com | sh

# 2. Клонировать репозиторий
git clone https://github.com/your/vector.git
cd vector
cp .env.example .env
# Отредактировать .env

# 3. Получить SSL-сертификат (первый раз — без certbot-контейнера)
docker run --rm -v ./certbot/conf:/etc/letsencrypt -v ./certbot/www:/var/www/certbot \
  -p 80:80 certbot/certbot certonly --standalone \
  -d yourdomain.ru --email your@email.ru --agree-tos --no-eff-email

# 4. Скачать модель
docker compose up -d ollama
docker exec vector_ollama ollama pull qwen2.5:7b

# 5. Запустить всё
docker compose up -d
```

---

## Запуск локально

### 1. Клонировать репозиторий и перейти в папку backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Настроить окружение

```bash
cp .env.example .env
# Отредактировать .env — вписать SMTP, SECRET_KEY и т.д.
```

### 3. Запустить backend

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Приложение доступно на `http://localhost:8000`.
Документация API: `http://localhost:8000/docs`

### 4. Ollama (для ИИ)

```bash
ollama serve
ollama pull qwen2.5:7b
```

---

## Переменные окружения (.env)

```env
DB_PATH=data/app.db
SECRET_KEY=your-secret-key
ACCESS_TOKEN_EXPIRE_MINUTES=10080

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
EMAIL_FROM=your@gmail.com

OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:7b

APP_URL=http://localhost:8000
DEBUG=true
```


---

## Система авторизации

- Регистрация → подтверждение email (6-значный код, 15 мин)
- Учителя регистрируются только по инвайт-коду (16 символов, генерирует админ)
- JWT-токен, время жизни 7 дней
- Сброс пароля через ссылку на email (токен живёт 1 час)
- Привязка родителя к ребёнку через 6-значный код в профиле ученика (живёт 24 часа)

---

## ИИ-ассистент

Модель **Qwen2.5:7b** через Ollama. Системный промпт запрещает решать задания и писать тексты — только планирование.

Возможности:
- Чат с контекстом текущих задач и расписания
- Анализ нагрузки на неделю
- Разбивка задачи на подзадачи (сохраняются в БД)
- Определение приоритетов

---

## База данных

SQLite3, файл `backend/data/app.db`. Таблицы создаются автоматически при первом запуске.

При изменении моделей — удалить `app.db` и перезапустить сервер (миграции не настроены, данные сбрасываются).

---

## Уведомления

- **Email** — через SMTP, очередь обрабатывается каждую минуту (APScheduler)
- **Браузер** — хранятся в БД, фронт запрашивает при загрузке страницы

Просроченные задачи помечаются каждые 10 минут фоновым джобом.