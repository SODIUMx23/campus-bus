/**
 * CampusMove fitness pedometer — student mode.
 *
 * Add this file to the repo. `src/hooks/useStepCounter.js` feeds it
 * DeviceMotion / Accelerometer samples; the student sheet renders the totals.
 *
 * Method (phone-in-pocket, orientation-independent):
 *  1. Acceleration magnitude. Prefer linear `acceleration`; otherwise
 *     high-pass the gravity-inclusive vector to drop the 1 g bias.
 *  2. Band-pass 0.85–3.2 Hz — walking ~1.4–2.2 Hz, jogging up to ~3 Hz.
 *  3. Adaptive threshold from a 2 s RMS window.
 *  4. Local-max peaks with a cadence-limited refractory period (0.28–0.95 s).
 *  5. Walking-bout gate: four valid peaks inside 3 s before any step is
 *     committed. Isolated jostles (picking up the phone, a bus bump) die here.
 *
 * GPS is never used for counting — it over-counts in a moving shuttle.
 */

export const STORE_KEY = "campusmove.fitness.v1";
export const DEFAULT_STRIDE_M = 0.74;
export const DEFAULT_GOAL = 8000;
export const DEFAULT_WEIGHT_KG = 65;

const HP_HZ = 0.85;
const LP_HZ = 3.2;
const MIN_DT = 0.008;
const MAX_DT = 0.08;
const MIN_INTERVAL = 0.28;
const MAX_INTERVAL = 0.95;
const BOUT_NEED = 4;
const BOUT_WINDOW = 3.0;
const BOUT_END = 2.4;
const STILL_RMS = 0.28;

function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function loadFitness() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    const date = todayKey();
    return {
      date,
      today: raw.date === date ? Number(raw.today) || 0 : 0,
      strideM: Number(raw.strideM) || DEFAULT_STRIDE_M,
      weightKg: Number(raw.weightKg) || DEFAULT_WEIGHT_KG,
      goal: Number(raw.goal) || DEFAULT_GOAL,
      auto: raw.auto === true,
    };
  } catch {
    return {
      date: todayKey(),
      today: 0,
      strideM: DEFAULT_STRIDE_M,
      weightKg: DEFAULT_WEIGHT_KG,
      goal: DEFAULT_GOAL,
      auto: false,
    };
  }
}

export function saveFitness(state) {
  localStorage.setItem(
    STORE_KEY,
    JSON.stringify({
      date: state.date || todayKey(),
      today: state.today || 0,
      strideM: state.strideM || DEFAULT_STRIDE_M,
      weightKg: state.weightKg || DEFAULT_WEIGHT_KG,
      goal: state.goal || DEFAULT_GOAL,
      auto: !!state.auto,
    })
  );
}

export function stepsToMetres(steps, strideM = DEFAULT_STRIDE_M) {
  return Math.max(0, steps) * Math.max(0.5, strideM);
}

export function kcalFromSteps(steps, weightKg = DEFAULT_WEIGHT_KG, strideM = DEFAULT_STRIDE_M) {
  const km = stepsToMetres(steps, strideM) / 1000;
  return km * Math.max(40, weightKg) * 0.5;
}

export function formatSteps(n) {
  return Math.max(0, Math.round(n) || 0).toLocaleString("en-IN");
}

/**
 * @param {object} [opts]
 * @param {(info: { t: number, cadence: number }) => void} [opts.onStep]
 */
export function createPedometer(opts = {}) {
  const onStep = opts.onStep || (() => {});

  let prevT = 0;
  let prevMag = 0;
  let hp = 0;
  let lp = 0;
  let prevLp = 0;
  let prev2Lp = 0;
  let lastPeakT = 0;
  let lastPeakAmp = 0;

  const rmsBuf = [];
  const peakTs = [];
  let bout = false;
  let pending = 0;

  function iir(mag, dt) {
    const rcH = 1 / (2 * Math.PI * HP_HZ);
    const aH = rcH / (rcH + dt);
    hp = aH * (hp + mag - prevMag);
    prevMag = mag;
    const rcL = 1 / (2 * Math.PI * LP_HZ);
    const aL = dt / (rcL + dt);
    lp += aL * (hp - lp);
    return lp;
  }

  function pushRms(v, t) {
    rmsBuf.push({ v, t });
    const cut = t - 2.0;
    while (rmsBuf.length && rmsBuf[0].t < cut) rmsBuf.shift();
    if (rmsBuf.length < 6) return 0;
    let s = 0;
    for (const s0 of rmsBuf) s += s0.v * s0.v;
    return Math.sqrt(s / rmsBuf.length);
  }

  function cadenceNow(t) {
    const recent = peakTs.filter((p) => t - p < 8);
    if (recent.length < 2) return 0;
    const span = t - recent[0];
    return span > 0 ? (recent.length / span) * 60 : 0;
  }

  function commit(t, n) {
    for (let i = 0; i < n; i++) onStep({ t, cadence: cadenceNow(t) });
  }

  function considerPeak(t, amp, rms) {
    const interval = lastPeakT ? t - lastPeakT : 1;
    if (interval < MIN_INTERVAL) return;
    if (lastPeakT && interval > MAX_INTERVAL && bout) {
      bout = false;
      pending = 0;
    }
    if (amp < Math.max(0.48, rms * 1.15)) return;
    if (lastPeakT && interval <= MAX_INTERVAL && lastPeakAmp && amp < lastPeakAmp * 0.22) return;

    lastPeakT = t;
    lastPeakAmp = amp;
    peakTs.push(t);
    while (peakTs.length && t - peakTs[0] > 12) peakTs.shift();

    const inWindow = peakTs.filter((p) => t - p <= BOUT_WINDOW).length;
    if (!bout) {
      pending += 1;
      if (inWindow >= BOUT_NEED && pending >= BOUT_NEED) {
        bout = true;
        commit(t, pending);
        pending = 0;
      }
      return;
    }
    commit(t, 1);
  }

  return {
    /**
     * @param {number} ax
     * @param {number} ay
     * @param {number} az
     * @param {number} tSeconds  monotonic seconds
     * @param {boolean} includesGravity
     */
    sample(ax, ay, az, tSeconds, includesGravity = true) {
      if (!Number.isFinite(ax + ay + az + tSeconds)) return;
      const mag = Math.hypot(ax, ay, az);
      let dt = prevT ? tSeconds - prevT : 0.02;
      prevT = tSeconds;
      if (dt <= 0) return;
      dt = Math.min(MAX_DT, Math.max(MIN_DT, dt));

      let filtered;
      if (includesGravity) {
        filtered = iir(mag, dt);
      } else {
        const rcL = 1 / (2 * Math.PI * LP_HZ);
        const aL = dt / (rcL + dt);
        lp += aL * (mag - lp);
        prevMag = mag;
        filtered = lp;
      }
      const rms = pushRms(filtered, tSeconds);

      if (bout && lastPeakT && tSeconds - lastPeakT > BOUT_END) {
        bout = false;
        pending = 0;
      }
      if (rms < STILL_RMS) {
        prev2Lp = prevLp;
        prevLp = filtered;
        return;
      }

      const isPeak = prevLp > prev2Lp && prevLp > filtered;
      if (isPeak) considerPeak(tSeconds, Math.abs(prevLp), rms);

      prev2Lp = prevLp;
      prevLp = filtered;
    },

    reset() {
      prevT = 0;
      prevMag = 0;
      hp = 0;
      lp = 0;
      prevLp = 0;
      prev2Lp = 0;
      lastPeakT = 0;
      lastPeakAmp = 0;
      rmsBuf.length = 0;
      peakTs.length = 0;
      bout = false;
      pending = 0;
    },

    get bout() {
      return bout;
    },
  };
}

/**
 * Synthetic 1.8 Hz walk for 10 s at 50 Hz should land near 18 steps
 * after the 4-step bout gate (~14–18). Used as a sanity check in /gps if needed.
 */
export function selfCheck() {
  let n = 0;
  const p = createPedometer({ onStep: () => n++ });
  const hz = 50;
  const cadenceHz = 1.8;
  const seconds = 10;
  for (let i = 0; i <= hz * seconds; i++) {
    const t = i / hz;
    const step = 2.2 * Math.sin(2 * Math.PI * cadenceHz * t);
    p.sample(0, 0, 9.81 + step, t, true);
  }
  return n;
}
