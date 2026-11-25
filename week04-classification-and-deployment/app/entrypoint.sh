#!/usr/bin/env bash
# One image, two front doors. APP_MODE picks which one opens.
set -euo pipefail

MODE="${APP_MODE:-streamlit}"
PORT="${PORT:-8501}"

if [ ! -f /app/models/diabetes_risk_model.joblib ]; then
  echo "No model files in /app/models."
  echo "Run 'python train_models.py' on the host before building, or mount a models volume."
  exit 1
fi

case "$MODE" in
  streamlit)
    exec streamlit run streamlit_app.py \
      --server.port="$PORT" --server.address=0.0.0.0 --server.headless=true
    ;;
  flask)
    # gunicorn, not flask's dev server: the dev server is single-threaded and says so.
    exec gunicorn --bind "0.0.0.0:$PORT" --workers 2 --timeout 60 flask_app:app
    ;;
  *)
    echo "APP_MODE must be 'streamlit' or 'flask', got '$MODE'"
    exit 1
    ;;
esac
