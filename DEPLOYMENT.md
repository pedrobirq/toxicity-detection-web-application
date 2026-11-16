# Руководство по локальному запуску, секретам, базе данных и деплою ToxicSpan Lab

## 1. Архитектура сервиса

Веб-приложение состоит из трёх частей:
1. **Веб-интерфейс и BFF (React + Express `server.ts`)** — принимает текст, визуализирует спаны в стиле NER, сохраняет логи и вердикты пользователей, при недоступности Python-воркера переключается на резервный режим `gemini-4-hydrogen`.
2. **Микросервис инференса на Python (`python_inference/main.py`)** — оборачивает ваш `ToxicSpanPredictor` и загружает веса `best_model.pt` + `tokenizer/`.
3. **База данных Firebase Firestore** — хранит:
   - `models` — метаданные версий модели, метрики качества (`Val Macro F1`, `per_class_f1`) и ссылку на веса `weightsUri`;
   - `request_logs` — историю всех запросов к модели, найденные спаны, движок инференса и статус проверки;
   - `labeled_samples` — подтверждённые или отклонённые пользователями примеры для дообучения в формате `cleaned_deduplicated_dataset.jsonl`.

> **Важно про веса модели (`best_model.pt`):** Чекпоинт PyTorch весит ~680 МБ, а лимит одного документа в Firestore — 1 МБ. Поэтому в базе хранится паспорт модели (метаданные, метрики и URI хранилища), а сами веса хранятся на локальном диске или в Hugging Face Hub / S3 / Google Cloud Storage.

---

## 2. Где регистрироваться и какие секреты получать

| Сервис | Зачем нужен | Какие ключи/файлы получите | Куда прописать |
|---|---|---|---|
| **Firebase Console** (`console.firebase.google.com`) | Облачная NoSQL-база данных Firestore (бесплатный тариф Spark) | Конфиг веб-приложения (`firebase-applet-config.json`: `apiKey`, `projectId`, `firestoreDatabaseId`) | Файл `firebase-applet-config.json` в корне проекта (создаётся автоматически в AI Studio) |
| **Hugging Face** (`huggingface.co`) | Хранение тяжёлых весов `best_model.pt` и `tokenizer/` для облачного деплоя | `HF_MODEL_REPO` (напр. `username/rubert-toxic-detector`) и `HF_TOKEN` (Read-токен для приватного репо) | Переменные окружения Python-сервера |
| **Google AI Studio** (`aistudio.google.com`) | Резервный демо-инференс (`gemini-4-hydrogen`), когда Python-сервер выключен | `GEMINI_API_KEY` | Вкладка **Secrets** в AI Studio или локальный `.env` |
| **Собственный токен защиты API** | Защита публичного Python-эндпоинта `/predict` от посторонних вызовов | Произвольная длинная строка (`openssl rand -hex 32`) | Одинаково задать в `MODEL_API_SECRET` для Node.js и для Python FastAPI |

---

## 3. Локальный запуск на компьютере для отладки

### Шаг A. Запуск Python-сервера с вашей обученной моделью

1. Скопируйте вашу директорию `models/rubert_toxic_detector` (где лежат `best_model.pt` и `tokenizer/`) в папку `python_inference/models/rubert_toxic_detector`.
2. Установите зависимости в ваше окружение Python 3.11:
   ```bash
   cd python_inference
   pip install -r requirements.txt
   uvicorn main:app --host 127.0.0.1 --port 8000
   ```
3. Проверьте готовность модели: откройте `http://127.0.0.1:8000/health`.

### Шаг B. Запуск веб-интерфейса (Node.js + Express)

1. В корне проекта создайте файл `.env` на основе `.env.example`:
   ```env
   PORT=3000
   APP_URL=http://localhost:3000
   MODEL_API_URL=http://127.0.0.1:8000
   MODEL_API_SECRET=
   GEMINI_API_KEY=ваш_ключ_если_нужен_резервный_режим
   ```
2. Установите пакеты и запустите сервер разработки:
   ```bash
   npm install
   npm run dev
   ```
3. Откройте `http://localhost:3000`. В разделе **«Модель и деплой»** индикатор покажет активное подключение к локальному FastAPI.

---

## 4. Интеграция с базой данных Firebase Firestore

1. **Инициализация**: Приложение считывает настройки подключения из `firebase-applet-config.json` (`getFirestore(app, firebaseConfig.firestoreDatabaseId)`).
2. **Безопасность без аутентификации**:
   - Так как MVP работает без регистрации пользователей, в `firestore.rules` настроена **валидация схемы без auth**:
     - Каждая запись `request_logs` проверяет длину текста (`1..4000`), допустимые категории (`profanity`, `insult`, `derogation_mockery`, `threat_violence`, `hate_speech`), серверную метку времени `request.time` и неизменяемость после выставления вердикта (`pending -> confirmed | rejected`).
     - Записи в `labeled_samples` нельзя перезаписывать или удалять через клиент, а при создании проверяется существование исходного лога `sourceLogId`.
3. **Деплой правил**: При переносе во внешний Firebase-проект разверните правила командой:
   ```bash
   firebase deploy --only firestore:rules
   ```
4. **Рекомендация для продакшна**: Перед открытием сервиса на широкий трафик включите **Firebase App Check** (reCAPTCHA v3) в Firebase Console, чтобы ограничить прямые запросы к Firestore только вашим доменом, либо перенесите запись логов на сервер Express через `firebase-admin`.

---

## 5. Деплой на внешние сервисы

### Вариант 1: Python-модель на Hugging Face Spaces / Render / Cloud Run + Веб-сервер на Render / Cloud Run

1. **Загрузите веса модели на Hugging Face Hub** (в приватный или публичный репозиторий):
   - Поместите внутрь `best_model.pt` и папку `tokenizer/`.
2. **Задеплойте Python-микросервис** (`python_inference/Dockerfile`):
   - Подходит **Google Cloud Run** (от 2–4 ГБ RAM для RuBERT), **Render** (Docker Web Service) или **Hugging Face Spaces (Docker)**.
   - Задайте переменные окружения:
     - `HF_MODEL_REPO=ваш_логин/rubert-toxic-detector`
     - `HF_TOKEN=hf_...` (если репозиторий приватный)
     - `MODEL_API_SECRET=длинный_случайный_токен`
     - `MODEL_VERSION=rubert-toxic-detector-v1`
3. **Задеплойте веб-приложение (Node.js)**:
   - Сборка: `npm run build`
   - Запуск: `npm run start` (или `npx tsx server.ts` для Node < 22.6)
   - Задайте переменные окружения (секреты) в панели хостинга:
     - `NODE_ENV=production`
     - `PORT=3000`
     - `MODEL_API_URL=https://url-вашего-python-сервиса`
     - `MODEL_API_SECRET=тот_же_случайный_токен`
     - `GEMINI_API_KEY=...` (опционально для резервного фоллбэка)

---

## 6. Дообучение модели на собранных пользователями данных

1. Откройте вкладку **«История и разметка»** и нажмите **«Скачать JSONL»**.
2. Выгруженный файл `user_labeled_dataset.jsonl` имеет точно такую же структуру, как `cleaned_deduplicated_dataset.jsonl`:
   ```json
   {"id": 0, "text": "...", "entities": [{"span": "...", "start": 2, "end": 7, "category": "profanity"}]}
   ```
3. Объедините его с исходным корпусом и запустите ваш скрипт обучения:
   ```bash
   python src/model_training/train.py --data_path data/merged_dataset.jsonl
   ```
4. После обучения зарегистрируйте новую версию модели и её метрики во вкладке **«Модель и деплой»**.
