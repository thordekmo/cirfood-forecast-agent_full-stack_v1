# CIRFOOD Forecast Stack (Backend + Frontend + Compose)

## Structure
```
cirfood-forecast-stack/
├─ backend/
│  ├─ forecast_service.py
│  ├─ requirements.txt
│  ├─ Dockerfile
│  └─ .env
├─ frontend/
│  ├─ Dockerfile           # dev (Vite)
│  ├─ Dockerfile.prod      # prod (Nginx static)
│  ├─ package.json
│  ├─ index.html
│  ├─ tsconfig.json, vite.config.ts, tailwind...
│  └─ src/ (UI code)
├─ data/                   # vendite.csv, scarto_teglia.csv, scarto_piatto.csv
├─ artifacts/              # forecasts_latest.json, model_registry_latest.json
└─ docker-compose.yml
```

## Quickstart (dev)
```bash
# 1) put your CSVs here:
#    data/vendite.csv
#    data/scarto_teglia.csv
#    data/scarto_piatto.csv

# 2) start both services
docker compose up --build

# UI:     http://localhost:5173
# API:    http://localhost:8000/health
```

## Backend (standalone)
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn forecast_service:app --host 0.0.0.0 --port 8000
```

## Frontend (standalone)
```bash
cd frontend
npm i
npm run dev
# open http://localhost:5173
```

## Production build (frontend)
```bash
cd frontend
docker build -f Dockerfile.prod -t cirfood-ui .
docker run -p 8080:80 cirfood-ui
```

Ensure backend CORS allows your UI origin via `backend/.env` (`ALLOWED_ORIGINS`).

## API Contract
- `GET /health`
- `POST /data/upload` (enabled when `ENABLE_DIRECT_UPLOAD=true`)
- `POST /jobs/run` → `{horizon, frequency}`
- `GET /forecasts/latest`
- `GET /model-registry`
