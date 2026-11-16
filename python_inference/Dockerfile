FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

# Права на запись для не-root контейнеров (например, UID 1000 в Hugging Face Spaces)
RUN mkdir -p /app/models /tmp/hf_cache && chmod -R 777 /app/models /tmp/hf_cache

# Опционально скопируйте локальную папку с весами перед сборкой:
# COPY models /app/models

ENV HF_HOME=/tmp/hf_cache
ENV MODEL_DIR=/app/models/rubert_toxic_detector
ENV MODEL_VERSION=rubert-toxic-detector-v1
ENV PORT=8000

EXPOSE 8000

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
