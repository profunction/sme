FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY backend/requirements.lock.txt backend/requirements.lock.txt
COPY deploy/requirements.txt deploy/requirements.txt
RUN pip install --no-cache-dir -r deploy/requirements.txt && useradd --uid 10001 --create-home nightbrew
COPY billing_service billing_service
COPY deploy deploy
USER nightbrew
EXPOSE 8000
CMD ["uvicorn","deploy.runtime:app","--host","0.0.0.0","--port","8000","--workers","1","--timeout-graceful-shutdown","30","--no-access-log"]
