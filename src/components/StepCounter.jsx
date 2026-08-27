import { formatSteps } from "../lib/pedometer.js";

function formatKm(m) {
  if (!Number.isFinite(m) || m < 1) return "0 m";
  if (m < 950) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

function Ring({ value, max }) {
  const r = 28;
  const c = 2 * Math.PI * r;
  const t = Math.max(0, Math.min(1, max ? value / max : 0));
  return (
    <svg className="step-ring" viewBox="0 0 72 72" width="72" height="72" aria-hidden>
      <circle cx="36" cy="36" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
      <circle
        cx="36"
        cy="36"
        r={r}
        fill="none"
        stroke="#34d399"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={`${c * t} ${c}`}
        transform="rotate(-90 36 36)"
      />
    </svg>
  );
}

/** Fitness step counter for student mode. Drop onto the Home sheet. */
export default function StepCounter({ counter }) {
  const {
    today,
    session,
    counting,
    walking,
    cadence,
    error,
    strideM,
    weightKg,
    goal,
    hz,
    distanceM,
    kcal,
    start,
    stop: pause,
    resetSession,
    resetToday,
    changeStride,
    changeWeight,
  } = counter;

  return (
    <div className="step-card fitness">
      <div className="step-main">
        <div className="step-ring-wrap">
          <Ring value={today} max={goal} />
          <div className={`step-num ${counting ? "live" : ""}`}>{formatSteps(today)}</div>
        </div>
        <div className="step-meta">
          <div className="step-kicker">
            {counting ? (walking ? "walking" : "sensor on") : "steps today"}
          </div>
          <div className="sub" style={{ margin: 0 }}>
            {formatKm(distanceM)} · {Math.round(kcal)} kcal · goal {formatSteps(goal)}
          </div>
          <div className="sub" style={{ margin: "4px 0 0" }}>
            {formatSteps(session)} this session
            {cadence ? ` · ${Math.round(cadence)} spm` : ""}
            {counting && hz ? ` · ${Math.round(hz)} Hz` : ""}
          </div>
        </div>
        <button
          className={counting ? "danger" : "primary"}
          style={{ padding: "8px 14px" }}
          onClick={counting ? pause : start}
        >
          {counting ? "Pause" : "Enable"}
        </button>
      </div>

      {error && <div className="sub">{error}</div>}

      <div className="step-tools">
        <label className="sub" style={{ display: "flex", gap: 6, alignItems: "center", margin: 0 }}>
          stride
          <input type="range" min="0.58" max="0.9" step="0.01" value={strideM} onChange={(e) => changeStride(e.target.value)} />
          {strideM.toFixed(2)} m
        </label>
        <label className="sub" style={{ display: "flex", gap: 6, alignItems: "center", margin: 0 }}>
          wt
          <input type="range" min="40" max="120" step="1" value={weightKg} onChange={(e) => changeWeight(e.target.value)} />
          {Math.round(weightKg)} kg
        </label>
        <button className="ghost" type="button" onClick={resetSession}>
          Reset session
        </button>
        <button className="ghost" type="button" onClick={resetToday}>
          Reset today
        </button>
      </div>
    </div>
  );
}
