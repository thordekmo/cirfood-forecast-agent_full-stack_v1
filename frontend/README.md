# CIRFOOD Forecast UI (frontend)
Vite + React + Tailwind. Talks to the FastAPI backend via `VITE_API_BASE_URL`.

## Dev
```bash
npm i
npm run dev   # http://localhost:5173
```
Set `.env` with:
```
VITE_API_BASE_URL=http://localhost:8000
VITE_ENABLE_DIRECT_UPLOAD=true
```

## Prod (Docker)
```bash
docker build -f Dockerfile.prod -t cirfood-ui .
docker run -p 8080:80 cirfood-ui
```
