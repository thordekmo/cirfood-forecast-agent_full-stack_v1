# forecast_service.py — CIRFOOD Forecast Service
# FastAPI backend for the UI. Endpoints:
#   GET  /health
#   GET  /            -> redirect to /docs
#   POST /data/upload (optional; enabled via ENABLE_DIRECT_UPLOAD=true)
#   POST /jobs/run
#   GET  /forecasts/latest
#   GET  /model-registry

import os
import json
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any

import pandas as pd
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

# ---- Environment ----
APP_VERSION = os.getenv("APP_VERSION", "0.0.1")
DATA_DIR = os.getenv("DATA_DIR", "./data")
ARTIFACTS_DIR = os.getenv("ARTIFACTS_DIR", "./artifacts")
FREQUENCY_DEFAULT = os.getenv("FREQUENCY", "W")  # W or M
HORIZON_DEFAULT = int(os.getenv("HORIZON", "8"))
ENABLE_DIRECT_UPLOAD = os.getenv("ENABLE_DIRECT_UPLOAD", "true").lower() == "true"

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(ARTIFACTS_DIR, exist_ok=True)

# ---- App & CORS ----
app = FastAPI(title="CIRFOOD Forecast Service", version=APP_VERSION)

allowed_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",")]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins if "*" not in allowed_origins else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- Helpers ----
EXPECTED_COLS = [
    "Regione", "Città", "Scuola", "Mese", "Settimana",
    "Categoria piatto", "Piatto", "Valore",
]

def _csv_path(name: str) -> str:
    return os.path.join(DATA_DIR, name)

def _artifact_path(name: str) -> str:
    return os.path.join(ARTIFACTS_DIR, name)

def read_csv_or_empty(file_name: str) -> pd.DataFrame:
    p = _csv_path(file_name)
    if not os.path.exists(p):
        return pd.DataFrame(columns=EXPECTED_COLS)
    try:
        df = pd.read_csv(p)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Unable to read {file_name}: {e}")
    # Normalize headers and ensure expected columns
    rename_map = {c: c.strip() for c in df.columns}
    df = df.rename(columns=rename_map)
    for col in EXPECTED_COLS:
        if col not in df.columns:
            df[col] = None
    return df[EXPECTED_COLS]

def save_json_artifact(name: str, data: Any) -> None:
    with open(_artifact_path(name), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)

def load_json_artifact(name: str) -> Any:
    p = _artifact_path(name)
    if not os.path.exists(p):
        return []
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)

def _next_periods(start: datetime, horizon: int, freq: str) -> List[str]:
    """Return ISO-like period labels for the next horizon periods."""
    out: List[str] = []
    cur = start
    for _ in range(horizon):
        if freq == "M":
            cur = cur + timedelta(days=30)   # approx monthly step
            out.append(cur.strftime("%Y-%m"))
        else:
            cur = cur + timedelta(days=7)    # weekly step
            out.append(cur.strftime("%Y-%m-%d"))
    return out

def _naive_forecast(series: List[float], horizon: int) -> List[float]:
    """Very simple baseline: mean of last up-to-4 points, repeated."""
    if not series:
        return [0.0] * horizon
    avg = sum(series[-4:]) / min(4, len(series))
    return [round(avg, 2)] * horizon

# ---- Models ----
class RunRequest(BaseModel):
    horizon: Optional[int] = None
    frequency: Optional[str] = None  # "W" or "M"

class RunResult(BaseModel):
    horizon: int
    frequency: str
    version: str
    generated_at: str
    summary: Dict[str, str]

# ---- Routes ----
@app.get("/", include_in_schema=False)
def root():
    """Make the service root useful on Render by redirecting to docs."""
    return RedirectResponse(url="/docs")

@app.get("/health")
def health():
    return {"status": "ok", "version": APP_VERSION}

@app.post("/data/upload")
def data_upload(
    vendite: UploadFile = File(...),
    scarto_teglia: UploadFile = File(...),
    scarto_piatto: UploadFile = File(...),
):
    if not ENABLE_DIRECT_UPLOAD:
        raise HTTPException(status_code=403, detail="Direct upload disabled on server")
    mapping = {
        "vendite.csv": vendite,
        "scarto_teglia.csv": scarto_teglia,
        "scarto_piatto.csv": scarto_piatto,
    }
    for fname, upl in mapping.items():
        with open(_csv_path(fname), "wb") as f:
            f.write(upl.file.read())
    return {"status": "ok", "data_dir": DATA_DIR}

@app.post("/jobs/run", response_model=RunResult)
def run_job(req: RunRequest):
    horizon = req.horizon or HORIZON_DEFAULT
    freq = (req.frequency or FREQUENCY_DEFAULT).upper()
    if freq not in ("W", "M"):
        raise HTTPException(status_code=400, detail="frequency must be 'W' or 'M'")

    # Read inputs
    df_v = read_csv_or_empty("vendite.csv")
    df_t = read_csv_or_empty("scarto_teglia.csv")
    df_p = read_csv_or_empty("scarto_piatto.csv")

    if df_v.empty:
        raise HTTPException(status_code=400, detail="vendite.csv is missing or empty")

    # Basic aggregation: net consumption by dish category
    key_cols = ["Categoria piatto"]
    for dframe in (df_v, df_t, df_p):
        dframe["Valore"] = pd.to_numeric(dframe["Valore"], errors="coerce").fillna(0.0)

    v = df_v.groupby(key_cols)["Valore"].sum().rename("vendite")
    t = df_t.groupby(key_cols)["Valore"].sum().rename("teglia")
    p = df_p.groupby(key_cols)["Valore"].sum().rename("piatto")
    agg = pd.concat([v, t, p], axis=1).fillna(0.0)
    agg["netto"] = (agg["vendite"] - agg["teglia"] - agg["piatto"]).clip(lower=0)

    # Naive forecast on each category
    forecasts: List[Dict[str, Any]] = []
    periods = _next_periods(datetime.utcnow(), horizon, "M" if freq == "M" else "W")
    for categoria, row in agg.iterrows():
        hist_series = [float(row["netto"])] * 8  # simulate small history
        fc_vals = _naive_forecast(hist_series, horizon)
        for ds, yhat in zip(periods, fc_vals):
            forecasts.append({
                "categoria": str(categoria),
                "ds": ds,
                "yhat": float(round(yhat, 2)),
                "yhat_lower": None,
                "yhat_upper": None,
            })

    save_json_artifact("forecasts_latest.json", forecasts)

    registry = [{
        "categoria": str(cat),
        "modello": "Naive-MA(4)",
        "params": {"window": 4, "frequency": freq},
        "timestamp": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "error": ""
    } for cat in agg.index.tolist()]
    save_json_artifact("model_registry_latest.json", registry)

    return RunResult(
        horizon=horizon,
        frequency=freq,
        version=APP_VERSION,
        generated_at=datetime.utcnow().isoformat(timespec="seconds") + "Z",
        summary={"categories": str(len(agg.index)), "points": str(len(forecasts))},
    )

@app.get("/forecasts/latest")
def get_forecasts_latest():
    return load_json_artifact("forecasts_latest.json")

@app.get("/model-registry")
def get_model_registry():
    return load_json_artifact("model_registry_latest.json")
