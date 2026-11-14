# One container = API (/api/...) + website (/app/). Build from the repo root:
#   docker build -t luminaluna . && docker run -p 8000:8000 luminaluna
FROM python:3.12-slim
WORKDIR /srv
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend backend
COPY app app
ENV PORT=8000
CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT}"]
