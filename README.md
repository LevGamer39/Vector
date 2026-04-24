# Vector — Умный планировщик для школьников

Веб-приложение для управления учебными задачами с ИИ-ассистентом. Разработано для WATA.

---

## Стек

### Backend
| Технология | Назначение |
|---|---|
| **FastAPI** (Python 3.12) | REST API, маршрутизация, валидация |
| **SQLite3** + **SQLAlchemy** | База данных, ORM |
| **python-jose** + **passlib[bcrypt]** | JWT-авторизация, хэширование паролей |
| **APScheduler** + **asyncio** | Фоновые задачи (просрочка дедлайнов, очередь уведомлений) |
| **SMTP** (локальный relay, порт 2525) | Email-уведомления |
| **httpx** | Асинхронные запросы к Ollama |

### AI
| Технология | Назначение |
|---|---|
| **Ollama** | Локальный LLM-сервер (Docker-контейнер) |
| **Qwen2.5:7b** | Языковая модель — планирование, приоритеты, разбивка задач |

### Frontend
| Технология | Назначение |
|---|---|
| **HTML / CSS / JS** | Без фреймворков |
| **Canvas API** | Графики успеваемости |
| **LocalStorage** | Хранение JWT и данных сессии |

### Инфраструктура
| Технология | Назначение |
|---|---|
| **Docker** + **Docker Compose** | Контейнеризация (backend, ollama, nginx) |
| **Nginx** | Reverse proxy, SSL termination |
| **Let's Encrypt** + **Certbot** | HTTPS-сертификат, автообновление |

### Планируется
- **Яндекс OAuth** — альтернативный способ входа

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
├── docker-compose.yml
├── .env
├── .env.example
├── .dockerignore
├── README.md
│
├── nginx/
│   ├── nginx.conf
│   └── certbot/              ← создаётся при первом запуске certbot
│       ├── conf/             ← сертификаты Let's Encrypt
│       └── www/              ← ACME challenge файлы
│
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py
│       ├── config.py
│       ├── database.py
│       ├── models.py
│       └── routers/
│           ├── users.py
│           ├── admin.py
│           ├── classes.py
│           ├── assignments.py
│           ├── tasks.py
│           ├── grades.py
│           ├── schedule.py
│           ├── ai.py
│           └── notifications.py
│
└── frontend/
    ├── index.html
    ├── login.html
    ├── register.html
    ├── verify.html
    ├── reset-password.html
    ├── reset-password-new.html
    ├── 404.html
    ├── settings.html
    ├── css/base.css
    ├── js/api.js
    ├── student/
    │   ├── dashboard.html / .css / .js
    │   ├── tasks.html / .css / .js
    │   ├── calendar.html
    │   ├── ai.html
    │   └── profile.html
    ├── teacher/
    │   ├── dashboard.html
    │   ├── classes.html
    │   ├── class.html
    │   ├── assignments.html
    │   └── assignment-new.html
    └── parent/
        ├── dashboard.html
        ├── child.html
        └── notifications.html
```

---

## Роли пользователей

| Роль | Возможности |
|---|---|
| **Ученик** | Задачи, календарь, ИИ-чат, расписание, оценки, профиль |
| **Учитель** | Создание заданий, управление классами, просмотр прогресса, оценки |
| **Родитель** | Просмотр задач и оценок ребёнка (только чтение), уведомления |
| **Администратор** | Генерация инвайт-кодов для учителей |

---

## Развёртывание

### Требования к серверу
- Публичный IP-адрес
- Docker + Docker Compose
- Домен с A-записью на IP сервера
- Открытые порты: 80, 443

### 1. Клонировать репозиторий

```bash
git clone <repo> /opt/vector
cd /opt/vector
```

### 2. Настроить .env

```bash
cp .env.example .env
nano .env
# Указать SECRET_KEY, SMTP, APP_URL=https://vkcollege.ru
```

### 3. Получить SSL-сертификат (первый раз)

Nginx не запустится без сертификата, поэтому сначала запрашиваем его через временный HTTP-сервер:

```bash
# Запустить только nginx в HTTP-режиме (без SSL-блока)
# Закомментировать server { listen 443... } в nginx.conf, запустить:
docker compose up -d nginx

# Получить сертификат
docker compose run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  -d vkcollege.ru -d www.vkcollege.ru \
  --email admin@vkcollege.ru \
  --agree-tos --no-eff-email

# Раскомментировать HTTPS-блок в nginx.conf
# Перезапустить nginx
docker compose restart nginx
```

### 4. Запустить все сервисы

```bash
docker compose up -d --build
```

### 5. Скачать модель Qwen (один раз)

```bash
docker exec vector_ollama ollama pull qwen2.5:7b
```

### 6. Проверить

```bash
docker compose ps          # все контейнеры Up
curl https://vkcollege.ru/health  # {"status":"ok"}
```

### Обновление приложения

```bash
git pull
docker compose up -d --build backend
```

### Просмотр логов

```bash
docker compose logs -f backend   # логи FastAPI
docker compose logs -f nginx     # логи nginx
docker compose logs -f ollama    # логи Ollama
```

---

## Переменные окружения (.env)

```env
# База данных
DB_PATH=data/app.db

# JWT — обязательно сменить
SECRET_KEY=замени-на-длинную-случайную-строку
ACCESS_TOKEN_EXPIRE_MINUTES=10080

# SMTP (локальный relay)
SMTP_HOST=127.0.0.1
SMTP_PORT=2525
SMTP_USER=
SMTP_PASSWORD=
EMAIL_FROM=noreply@vkcollege.ru

# Ollama (имя Docker-сервиса)
OLLAMA_URL=http://ollama:11434
OLLAMA_MODEL=qwen2.5:7b

# Приложение
APP_URL=https://vkcollege.ru
DEBUG=false
```

---

## Система авторизации

- Регистрация → подтверждение email (6-значный код, 15 мин)
- Учителя регистрируются только по инвайт-коду (генерирует админ)
- JWT-токен, время жизни 7 дней
- Сброс пароля через ссылку на email (токен живёт 1 час)
- Привязка родителя к ребёнку через 6-значный код из профиля ученика (живёт 24 часа)
- Яндекс OAuth — запланирован

---

## ИИ-ассистент

Модель **Qwen2.5:7b** через Ollama. Запрещено решать задания и писать тексты за ученика.

- Чат с контекстом текущих задач и расписания
- Анализ нагрузки на неделю
- Разбивка задачи на подзадачи (сохраняются в БД)
- Определение приоритетов

---

## База данных

SQLite3, файл `backend/data/app.db`, смонтирован как Docker volume. Таблицы создаются автоматически при первом запуске.

При изменении моделей — удалить `data/app.db` и перезапустить `backend` (данные сбросятся).

---

## Уведомления

- **Email** — через локальный SMTP-relay (порт 2525), очередь обрабатывается каждую минуту
- **Браузер** — хранятся в БД, фронт запрашивает при загрузке страницы
- **Telegram** — не реализован

Просроченные задачи помечаются каждые 10 минут фоновым джобом.
