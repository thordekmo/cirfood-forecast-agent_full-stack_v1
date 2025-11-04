import React, { useMemo, useState, useEffect } from "react";
import { TrendingUp, Settings, Download, AlertTriangle, Upload, FileUp } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

const theme = { primary: "#0A8F4A", primaryDark: "#086C38", primarySoft: "#E6F4ED", accent: "#00B28F" };
const API_BASE: string = (import.meta as any).env?.VITE_API_BASE_URL || "http://localhost:8000";
const ENABLE_DIRECT_UPLOAD = (import.meta as any).env?.VITE_ENABLE_DIRECT_UPLOAD === "true";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers: { Accept: "application/json", ...(init?.headers || {}) } });
  if (!res.ok) { const text = await res.text().catch(() => ""); throw new Error(`${res.status} ${res.statusText} – ${text}`); }
  return res.json() as Promise<T>;
}

type RunRequest = { horizon?: number; frequency?: string };
type RunResult = { horizon: number; frequency: string; version: string; generated_at: string; summary: Record<string,string> };
type ForecastItem = { categoria: string; ds: string; yhat: number; yhat_lower?: number | null; yhat_upper?: number | null };
type RegistryItem = { categoria: string; modello: string; params?: Record<string, any>; timestamp?: string; error?: string };

const Service = {
  health: () => api<{status: string; version: string}>(`/health`),
  runJob: (body: RunRequest) => api<RunResult>(`/jobs/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  latestForecasts: () => api<ForecastItem[]>(`/forecasts/latest`),
  modelRegistry: () => api<RegistryItem[]>(`/model-registry`),
  uploadInputs: async (files: { vendite: File; scarto_teglia: File; scarto_piatto: File }) => {
    if (!ENABLE_DIRECT_UPLOAD) throw new Error("Direct upload disabled. Place files into DATA_DIR on the server.");
    const fd = new FormData();
    fd.append("vendite", files.vendite);
    fd.append("scarto_teglia", files.scarto_teglia);
    fd.append("scarto_piatto", files.scarto_piatto);
    const res = await fetch(`${API_BASE}/data/upload`, { method: "POST", body: fd });
    if (!res.ok) throw new Error(`Upload failed ${res.status}`);
    return res.json();
  }
};

type Row = { Regione:string; Città:string; Scuola:string; Mese:number|string; Settimana:number|string; "Categoria piatto":string; Piatto:string; Valore:number|string };
type CleansedRow = Row & { ConsumoNetto:number }
type UIState = { files: { vendite?: File; scarto_teglia?: File; scarto_piatto?: File }; uploadErrors: { fileName: string; message: string }[]; vendite: Row[]; scartoTeglia: Row[]; scartoPiatto: Row[]; cleansed: CleansedRow[]; forecasts: ForecastItem[]; registry: RegistryItem[]; };
function useUiState() { const [state, setState] = useState<UIState>({ files: {}, uploadErrors: [], vendite: [], scartoTeglia: [], scartoPiatto: [], cleansed: [], forecasts: [], registry: [] }); return { state, setState }; }
async function parseCsv<T = any>(file: File): Promise<T[]> { const text = await file.text(); const lines = text.split(/\r?\n/).filter(Boolean); if (!lines.length) return []; const headers = lines[0].split(",").map(h => h.trim()); const rows = lines.slice(1); return rows.map((r) => { const cells = r.split(",").map(c => c.trim()); const o: any = {}; headers.forEach((h, i) => o[h] = cells[i] ?? ""); return o as T; }); }

const Pill: React.FC<{ tone: "ok" | "warn" | "muted"; children: React.ReactNode }> = ({ tone, children }) => { const tones = { ok: "bg-emerald-100 text-emerald-800", warn: "bg-amber-100 text-amber-800", muted: "bg-slate-100 text-slate-700" } as const; return <span className={"px-2 py-1 rounded-full text-xs " + tones[tone]}>{children}</span>; };
const Section: React.FC<{ title: string; subtitle?: string; children: React.ReactNode }> = ({ title, subtitle, children }) => (<div className="border bg-white rounded-2xl shadow-sm p-6 space-y-4"><div><h2 className="text-xl font-semibold" style={{ color: theme.primary }}>{title}</h2>{subtitle && <p className="text-sm text-slate-600">{subtitle}</p>}</div>{children}</div>);

function DataUpload({ state, setState }: { state:UIState; setState: React.Dispatch<React.SetStateAction<UIState>> }) {
  const [busy, setBusy] = useState(false); const [uploadInfo, setUploadInfo] = useState("");
  async function validateAndPreview() {
    setBusy(true); const errors: UIState["uploadErrors"] = [];
    try {
      const v = state.files.vendite, st = state.files.scarto_teglia, sp = state.files.scarto_piatto;
      if (!v || !st || !sp) { errors.push({ fileName: "-", message: "Select vendite.csv, scarto_teglia.csv, scarto_piatto.csv" }); }
      else {
        const venditeRows = await parseCsv<Row>(v); const stRows = await parseCsv<Row>(st); const spRows = await parseCsv<Row>(sp);
        const required = ["Regione","Città","Scuola","Mese","Settimana","Categoria piatto","Piatto","Valore"];
        const headers = venditeRows.length ? Object.keys(venditeRows[0]) : [];
        for (const h of required) if (!headers.includes(h)) errors.push({ fileName: v.name, message: `Missing header: ${h}` });
        const key = (r: any) => [r["Regione"], r["Città"], r["Scuola"], r["Mese"], r["Settimana"], r["Categoria piatto"], r["Piatto"]].join("|#|");
        const mapST = new Map(stRows.map(r => [key(r), Number((r as any).Valore) || 0] as const));
        const mapSP = new Map(spRows.map(r => [key(r), Number((r as any).Valore) || 0] as const));
        const cleansed = venditeRows.map(r => { const teglia = mapST.get(key(r)) ?? 0; const piatto = mapSP.get(key(r)) ?? 0; const netto = Math.max(0, (Number((r as any).Valore) || 0) - teglia - piatto); return { ...r, ConsumoNetto: netto } as CleansedRow; });
        if (!errors.length) setState(s => ({ ...s, vendite: venditeRows, scartoTeglia: stRows, scartoPiatto: spRows, cleansed }));
      }
    } finally { setState(s => ({ ...s, uploadErrors: errors })); setBusy(false); }
  }
  async function uploadToServer() {
    const v = state.files.vendite, st = state.files.scarto_teglia, sp = state.files.scarto_piatto;
    if (!v || !st || !sp) return;
    try { const resp = await Service.uploadInputs({ vendite: v, scarto_teglia: st, scarto_piatto: sp }); setUploadInfo(JSON.stringify(resp)); }
    catch (e:any) { setUploadInfo(e.message || String(e)); }
  }
  return (<Section title="Data Upload" subtitle="Validate the three input CSVs. Optionally upload to server if enabled.">
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {[{ key: "vendite", label: "vendite.csv" }, { key: "scarto_teglia", label: "scarto_teglia.csv" }, { key: "scarto_piatto", label: "scarto_piatto.csv" }].map((r:any) => (
        <div key={r.key} className="flex flex-col gap-2 p-4 rounded-2xl border bg-white">
          <label className="text-sm font-medium">{r.label}</label>
          <input type="file" accept=".csv" onChange={(e) => setState(s => ({ ...s, files: { ...s.files, [r.key]: e.target.files?.[0] } }))} />
          <div className="text-xs text-slate-500 truncate">{(state.files as any)[r.key]?.name || "No file selected"}</div>
        </div>
      ))}
    </div>
    <div className="flex items-center gap-3 flex-wrap">
      <button onClick={validateAndPreview} disabled={busy} className="rounded-2xl px-4 py-2 text-white" style={{ backgroundColor: theme.primary }}><span className="inline-flex items-center gap-2"><Upload size={16}/> Validate locally</span></button>
      <Pill tone={state.cleansed.length ? "ok" : "muted"}>{state.cleansed.length ? "Validated" : "Waiting for files…"}</Pill>
      <button onClick={uploadToServer} disabled={!state.cleansed.length || !ENABLE_DIRECT_UPLOAD} className="rounded-2xl px-4 py-2 border"><span className="inline-flex items-center gap-2"><FileUp size={16}/> Upload to server</span></button>
      <span className="text-xs text-slate-600">Direct upload: {ENABLE_DIRECT_UPLOAD ? "enabled" : "disabled"}</span>
    </div>
    {uploadInfo && <div className="text-xs bg-slate-50 p-3 rounded-xl border">{uploadInfo}</div>}
    {state.uploadErrors.length > 0 && (<div className="space-y-2">{state.uploadErrors.map((e, i) => (<div key={i} className="flex items-start gap-2 text-amber-700 bg-amber-50 border border-amber-200 p-3 rounded-xl"><AlertTriangle className="h-4 w-4 mt-0.5" /><div><div className="font-medium">{e.fileName}</div><div className="text-sm">{e.message}</div></div></div>))}</div>)}
  </Section>);
}

function DataCleansing({ state }: { state:UIState }) {
  const rows = state.cleansed;
  return (<Section title="Data Cleansing" subtitle="Local preview of net consumption (Vendite − Scarto teglia − Scarto piatto).">
    {rows.length === 0 ? (<div className="text-sm text-slate-600">Upload and validate inputs to see cleansing preview.</div>) : (
      <div className="overflow-auto border rounded-2xl"><table className="min-w-[900px] w-full text-sm"><thead className="bg-slate-50"><tr>{["Regione","Città","Scuola","Mese","Settimana","Categoria piatto","Piatto","Consumo Netto"].map(h => <th key={h} className="text-left px-3 py-2 font-medium">{h}</th>)}</tr></thead><tbody>{rows.slice(0,300).map((r,i) => (<tr key={i} className="border-t"><td className="px-3 py-2">{(r as any).Regione}</td><td className="px-3 py-2">{(r as any).Città}</td><td className="px-3 py-2">{(r as any).Scuola}</td><td className="px-3 py-2">{String((r as any).Mese)}</td><td className="px-3 py-2">{String((r as any).Settimana)}</td><td className="px-3 py-2">{(r as any)["Categoria piatto"]}</td><td className="px-3 py-2">{(r as any).Piatto}</td><td className="px-3 py-2 text-right">{Number((r as any).ConsumoNetto||0).toLocaleString()}</td></tr>))}</tbody></table></div>
    )}
  </Section>);
}

function BaselineAndForecast({ state, setState }: { state:UIState; setState: React.Dispatch<React.SetStateAction<UIState>> }) {
  const [busy, setBusy] = useState(false);
  const [horizon, setHorizon] = useState<number>(8);
  const [frequency, setFrequency] = useState<string>("W");
  const [info, setInfo] = useState<string>("");
  const [selectedCat, setSelectedCat] = useState<string>("ALL");
  async function run() {
    setBusy(true); setInfo("");
    try { const meta = await Service.runJob({ horizon, frequency }); setInfo(`Job ok • v${meta.version} • ${meta.generated_at}`); const [fc, reg] = await Promise.all([Service.latestForecasts(), Service.modelRegistry()]); setState(s => ({ ...s, forecasts: fc, registry: reg })); }
    catch (e:any) { setInfo(e.message || String(e)); } finally { setBusy(false); }
  }
  const categories = Array.from(new Set(state.forecasts.map(f => f.categoria))).sort();
  const chart = useMemo(() => { const data = state.forecasts.filter(f => selectedCat === "ALL" || f.categoria === selectedCat).sort((a,b) => a.ds.localeCompare(b.ds)); return data.map(d => ({ date: d.ds, Forecast: d.yhat })); }, [state.forecasts, selectedCat]);
  return (<Section title="Baseline & Forecast" subtitle="Run server job (/jobs/run) then load latest forecasts & model registry.">
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <div className="flex flex-col gap-2"><label>Horizon (periods)</label><input type="number" className="border rounded px-2 py-1" value={horizon} onChange={(e) => setHorizon(parseInt(e.target.value || "0", 10))} /></div>
      <div className="flex flex-col gap-2"><label>Frequency</label><select className="border rounded px-2 py-1" value={frequency} onChange={(e)=>setFrequency(e.target.value)}><option value="W">W</option><option value="M">M</option></select></div>
      <div className="flex flex-col gap-2"><label>Category filter</label><select className="border rounded px-2 py-1" value={selectedCat} onChange={(e)=>setSelectedCat(e.target.value)}><option value="ALL">ALL</option>{categories.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
    </div>
    <div className="flex items-center gap-3 flex-wrap">
      <button onClick={run} disabled={busy} className="rounded-2xl px-4 py-2 text-white" style={{ backgroundColor: theme.primary }}><span className="inline-flex items-center gap-2"><TrendingUp size={16}/> Run Forecast Job</span></button>
      <Pill tone={state.forecasts.length ? "ok" : "muted"}>{state.forecasts.length ? `${state.forecasts.length} points loaded` : "No data"}</Pill>
      <span className="text-xs text-slate-600">{info}</span>
    </div>
    <div className="h-72 w-full"><ResponsiveContainer width="100%" height="100%"><LineChart data={chart}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" /><YAxis /><Tooltip /><Legend /><Line type="monotone" dataKey="Forecast" name="Forecast (yhat)" stroke={theme.primary} dot={false} /></LineChart></ResponsiveContainer></div>
  </Section>);
}

function ForecastVsConsumption({ state }: { state:UIState }) {
  const asByDate = useMemo(() => { const map = new Map<string, number>(); for (const r of state.vendite) { const d = String((r as any).Mese || (r as any).Settimana); map.set(d, (map.get(d) || 0) + (Number((r as any).Valore) || 0)); } return map; }, [state.vendite]);
  const fcByDate = useMemo(() => { const map = new Map<string, number>(); for (const f of state.forecasts) { const d = f.ds; map.set(d, (map.get(d) || 0) + (f.yhat || 0)); } return map; }, [state.forecasts]);
  const dates = useMemo(() => Array.from(new Set([...asByDate.keys(), ...fcByDate.keys()])).sort(), [asByDate, fcByDate]);
  const chart = dates.map(d => ({ date: d, Actual: asByDate.get(d) || 0, Forecast: fcByDate.get(d) || 0 }));
  const totalF = chart.reduce((a,r)=>a+r.Forecast,0), totalA = chart.reduce((a,r)=>a+r.Actual,0);
  function fakeMape(rows: { Forecast: number; Actual: number }[]) { const parts = rows.map((r) => (r.Actual ? Math.abs((r.Actual - r.Forecast) / r.Actual) : 0)); return Number((100 * (parts.reduce((a, x) => a + x, 0) / (parts.length || 1))).toFixed(1)); }
  return (<Section title="Forecast vs. Consumption" subtitle="Compares server forecasts to local actuals (vendite.csv).">
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3"><Kpi label="Total Forecast" value={totalF} /><Kpi label="Total Actual" value={totalA} /><Kpi label="Delta" value={totalF-totalA} tone="warn" /><Kpi label="MAPE (demo)" value={fakeMape(chart)} suffix="%" /></div>
    <div className="h-80 w-full"><ResponsiveContainer width="100%" height="100%"><BarChart data={chart}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" /><YAxis /><Tooltip /><Legend /><Bar dataKey="Forecast" fill={theme.primary} /><Bar dataKey="Actual" fill={theme.accent} /></BarChart></ResponsiveContainer></div>
  </Section>);
}
function Kpi({ label, value, suffix, tone = "ok" }: { label:string; value:number; suffix?:string; tone?:"ok"|"warn"|"muted" }) { return (<div className="rounded-2xl border bg-white p-4"><div className="text-xs text-slate-500">{label}</div><div className="text-2xl font-semibold">{Number(value||0).toLocaleString()} {suffix}</div><div className="mt-2"><Pill tone={tone}>{tone === "ok" ? "Stable" : tone === "warn" ? "Attention" : "Info"}</Pill></div></div>); }
function PerformanceDashboard({ state }: { state:UIState }) { const cats = Array.from(new Set(state.forecasts.map(f => f.categoria))).sort(); return (<Section title="Performance Dashboard" subtitle="Key forecast indicators by category (demo)."><div className="overflow-auto border rounded-2xl"><table className="min-w-[760px] w-full text-sm"><thead className="bg-slate-50"><tr>{["Dish Category","Model","Params","Last updated"].map(h => <th key={h} className="text-left px-3 py-2 font-medium">{h}</th>)}</tr></thead><tbody>{cats.map(c => { const r = state.registry.find(x => x.categoria === c); return (<tr key={c} className="border-t"><td className="px-3 py-2">{c}</td><td className="px-3 py-2">{r?.modello || "-"}</td><td className="px-3 py-2 text-xs">{r?.params ? JSON.stringify(r.params) : "-"}</td><td className="px-3 py-2 text-xs">{r?.timestamp || "-"}</td></tr>); })}</tbody></table></div></Section>); }
function ModelMaintenance({ state }: { state:UIState }) { return (<Section title="Forecast Model Maintenance" subtitle="Displays the latest model registry from the server."><div className="overflow-auto border rounded-2xl"><table className="min-w-[900px] w-full text-sm"><thead className="bg-slate-50"><tr>{["Dish Category","Model","Params","Timestamp","Error"].map(h => <th key={h} className="text-left px-3 py-2 font-medium">{h}</th>)}</tr></thead><tbody>{state.registry.map((r,i) => (<tr key={`${r.categoria}-${i}`} className="border-t"><td className="px-3 py-2">{r.categoria}</td><td className="px-3 py-2">{r.modello}</td><td className="px-3 py-2 text-xs">{r.params ? JSON.stringify(r.params) : "-"}</td><td className="px-3 py-2 text-xs">{r.timestamp || "-"}</td><td className="px-3 py-2 text-xs text-rose-700">{r.error || ""}</td></tr>))}</tbody></table></div></Section>); }

export default function App() {
  const { state, setState } = useUiState();
  const [compact, setCompact] = useState(false);
  const [svcOk, setSvcOk] = useState<string>("");
  const [tab, setTab] = useState<string>("upload");
  useEffect(() => { (async () => { try { const h = await Service.health(); setSvcOk(`Service OK • v${h.version}`); } catch (e: any) { setSvcOk(`Service unreachable: ${e.message || e}`); } })(); }, []);
  const tabs = [{ id: "upload", label: "1) Data Upload", el: <DataUpload state={state} setState={setState} /> },{ id: "cleansing", label: "2) Data Cleansing", el: <DataCleansing state={state} /> },{ id: "baseline", label: "3) Baseline & Forecast", el: <BaselineAndForecast state={state} setState={setState} /> },{ id: "forecast", label: "4) Forecast Consumption", el: <ForecastVsConsumption state={state} /> },{ id: "performance", label: "5) Performance", el: <PerformanceDashboard state={state} /> },{ id: "models", label: "6) Model Maintenance", el: <ModelMaintenance state={state} /> }] as const;
  return (<div className={"min-h-screen w-full " + (compact ? "text-[13px]" : "text-base")} style={{ background: theme.primarySoft }}><header className="sticky top-0 z-10 backdrop-blur bg-white/70 border-b"><div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between"><div className="flex items-center gap-3"><div className="h-8 w-8 rounded-full" style={{ background: theme.primary }} /><div><div className="font-semibold" style={{ color: theme.primaryDark }}>CIRFOOD Planning Studio</div><div className="text-xs text-slate-600">{svcOk}</div></div></div><div className="flex items-center gap-3"><label className="text-sm inline-flex items-center gap-2"><input type="checkbox" checked={compact} onChange={(e)=>setCompact(e.target.checked)} />Compact</label><button className="rounded-2xl px-3 py-2 border"><span className="inline-flex items-center gap-2"><Download size={16}/>Export View</span></button><button className="rounded-2xl px-3 py-2 text-white" style={{ backgroundColor: theme.primary }}><span className="inline-flex items-center gap-2"><Settings size={16}/>Settings</span></button></div></div></header><main className="max-w-7xl mx-auto px-4 py-8 space-y-8"><div className="grid w-full grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-2">{tabs.map(t => (<button key={t.id} className={"px-3 py-2 rounded-2xl border " + (tab===t.id ? "bg-white border-brand text-brand-dark font-medium" : "bg-white/70")} onClick={()=>setTab(t.id)}>{t.label}</button>))}</div><div className="space-y-6 pt-4">{tabs.find(t => t.id===tab)?.el}</div><footer className="text-xs text-slate-500 py-8">UI wired to: <code>/health</code>, <code>/jobs/run</code>, <code>/forecasts/latest</code>, <code>/model-registry</code>. Optional <code>/data/upload</code> if enabled.</footer></main></div>);
}
