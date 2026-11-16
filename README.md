# ToxicSpan Lab — веб-сервис детекции токсичных языковых паттернов (RuBERT NER)

Единый fullstack-репозиторий для демонстрации обученной модели `RuBertToxicDetector`, NER-визуализации токсичных спанов, логирования запросов и сбора пользовательской разметки для дообучения без аутентификации.

## Структура репозитория

- `src/` — фронтенд на React + TypeScript + Tailwind CSS (NER-подсветка по 5 классам, история запросов, экспорт JSONL, паспорт модели).
- `server.ts` — BFF-сервер на Node.js + Express (раздача SPA, проксирование `/api/analyze` в Python FastAPI, автоматический резервный режим на `gemini-4-hydrogen`).
- `python_inference/` — готовый **Python FastAPI-сервер** (`main.py`), оборачивающий вашу архитектуру `RuBertToxicDetector` и `ToxicSpanPredictor`, плюс `Dockerfile` и `requirements.txt`.
- `firebase-blueprint.json`, `firestore.rules`, `firebase-applet-config.json` — схема, правила безопасности и конфиг Firebase Firestore.
- `Dockerfile`, `docker-compose.yml` — контейнеризация всего проекта одной командой.
- `DEPLOYMENT.md` — детальное руководство по секретам, БД и деплою.

---

## Быстрый старт после `git clone`

### Сценарий 1. Локальный запуск для разработки (2 терминала)

Подходит, если у вас есть локальный файл `best_model.pt` (и папка `tokenizer/`).

1. **Клонируйте репозиторий и поместите веса модели:**
   Скопируйте вашу обученную папку `rubert_toxic_detector` (внутри должен быть `best_model.pt` и желательно папка `tokenizer/`) по пути:
   ```text
   python_inference/models/rubert_toxic_detector/best_model.pt
   ```
   *(Если папки `tokenizer/` нет рядом с чекпоинтом, FastAPI автоматически скачает токенизатор `DeepPavlov/rubert-base-cased` с Hugging Face Hub при первом старте).*

2. **Терминал 1 — запустите Python FastAPI-сервер модели:**
   ```bash
   cd python_inference
   python -m venv .venv
   # Windows: .venv\Scripts\activate
   # Linux/macOS: source .venv/bin/activate
   pip install -r requirements.txt
   uvicorn main:app --host 127.0.0.1 --port 8000
   ```
   Проверьте, что модель загрузилась: `http://127.0.0.1:8000/health` (и интерактивный Swagger: `http://127.0.0.1:8000/docs`).

3. **Терминал 2 — настройте `.env` и запустите веб-сервер (в корне проекта):**
   ```bash
   cp .env.example .env
   ```
   Откройте `.env` и убедитесь, что задано:
   ```env
   PORT=3000
   APP_URL=http://localhost:3000
   MODEL_API_URL=http://127.0.0.1:8000
   MODEL_API_SECRET=
   GEMINI_API_KEY=
   ```
   Затем установите зависимости и запустите веб-приложение:
   ```bash
   npm install
   npm run dev
   ```
   Откройте `http://localhost:3000`. В разделе **«Модель и деплой»** статус должен показать **«Подключён и готов»**.

---

### Сценарий 2. Локальный запуск (или VPS) одной командой через Docker Compose

1. Поместите веса в `python_inference/models/rubert_toxic_detector/best_model.pt`.
2. При необходимости создайте `.env` (или используйте значения по умолчанию).
3. Выполните:
   ```bash
   docker compose up --build
   ```
   После сборки веб-приложение будет доступно на `http://localhost:3000`, а FastAPI — на `http://localhost:8000`.

---

### Сценарий 3. Деплой в облако из GitHub

Поскольку чекпоинт `best_model.pt` весит ~680 МБ (превышает лимит файла на GitHub в 100 МБ), **не коммитьте его в Git** (папка `models/` уже добавлена в `.gitignore`). Выгрузите веса на **Hugging Face Hub**, а код задеплойте на облачные сервисы:

1. **Загрузите веса на Hugging Face Hub** (`huggingface.co/new-model`):
   - Положите в репозиторий `best_model.pt` и папку `tokenizer/`.
2. **Разверните Python FastAPI (`python_inference/Dockerfile`)** на **Hugging Face Spaces (Docker)**, **Render** или **Google Cloud Run** (выделите от 2–4 ГБ RAM под RuBERT):
   - `HF_MODEL_REPO=ваш_логин/rubert-toxic-detector`
   - `HF_TOKEN=hf_...` *(если репозиторий приватный)*
   - `MODEL_API_SECRET=<случайный длинный токен>`
3. **Разверните веб-сервис (`Dockerfile` или Node.js build/start)** на **Render**, **Railway** или **Google Cloud Run**:
   - `NODE_ENV=production`
   - `PORT=3000`
   - `MODEL_API_URL=https://url-вашего-python-сервиса`
   - `MODEL_API_SECRET=<тот же токен>`
   - `GEMINI_API_KEY=<опционально для резервного фоллбэка>`

Подробное описание переменных окружения, интеграции с Firebase Firestore, правил безопасности и цикла дообучения см. в [`DEPLOYMENT.md`](./DEPLOYMENT.md).
