# StudyMate AI backend. Build from the repository root: docker build -f backend/Dockerfile backend
FROM python:3.12-slim AS base

# Native build tools for packages that compile from source on some platforms (e.g. psycopg's
# binary wheel usually covers this, but chromadb/sentence-transformers' transitive deps
# sometimes don't ship a wheel for every architecture); removed again after pip install to keep
# the final image small.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install the CPU-only PyTorch wheel first (see README): the plain PyPI index defaults to a much
# larger CUDA-enabled build that a CPU-only container will never use.
COPY requirements.txt .
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.9.1 \
    && pip install --no-cache-dir -r requirements.txt \
    && apt-get purge -y build-essential && apt-get autoremove -y

COPY app ./app

# Everything mutable (SQLite file, Chroma vector store, uploads, TTS cache) lives under one
# volume mount point so a single `-v` (or Compose volume) makes all of it persistent.
RUN mkdir -p /data && useradd --create-home --uid 1000 studymate && chown -R studymate /app /data
USER studymate

ENV DATABASE_URL=sqlite:////data/studymate.db \
    CHROMA_DIR=/data/chroma \
    UPLOAD_DIR=/data/uploads \
    TTS_AUDIO_DIR=/data/tts_audio \
    PYTHONUNBUFFERED=1

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health')" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
