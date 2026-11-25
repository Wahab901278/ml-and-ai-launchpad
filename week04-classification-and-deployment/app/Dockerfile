# One container, two models, two possible front doors.
FROM python:3.11-slim

# Keeps the image small and the logs unbuffered so `docker logs` is useful.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8501 \
    APP_MODE=streamlit

WORKDIR /app

# Dependencies first, in their own layer: application code changes far more often than
# requirements.txt, and Docker reuses this layer every time it has not changed.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Then the app itself, models included.
COPY features.py model_service.py streamlit_app.py flask_app.py train_models.py ./
COPY templates/ ./templates/
COPY models/ ./models/
COPY entrypoint.sh .

# Do not run as root just because the base image does.
RUN useradd --create-home appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8501

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,os,sys; \
p=os.environ.get('PORT','8501'); \
u='/healthz' if os.environ.get('APP_MODE','streamlit')=='streamlit' else '/health'; \
sys.exit(0 if urllib.request.urlopen(f'http://127.0.0.1:{p}{u}',timeout=4).status==200 else 1)"

ENTRYPOINT ["./entrypoint.sh"]
