import { useCallback, useEffect, useRef, useState } from "react";
import {
  createPedometer,
  kcalFromSteps,
  loadFitness,
  saveFitness,
  stepsToMetres,
} from "../lib/pedometer.js";

function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Student-mode fitness hook. Motion sensors only — never GPS. */
export function useStepCounter() {
  const saved = useRef(loadFitness());
  const [today, setToday] = useState(saved.current.today);
  const [session, setSession] = useState(0);
  const [counting, setCounting] = useState(false);
  const [walking, setWalking] = useState(false);
  const [cadence, setCadence] = useState(0);
  const [error, setError] = useState("");
  const [strideM, setStrideM] = useState(saved.current.strideM);
  const [weightKg, setWeightKg] = useState(saved.current.weightKg);
  const [goal, setGoal] = useState(saved.current.goal);
  const [hz, setHz] = useState(0);

  const countingRef = useRef(false);
  const sessionRef = useRef(0);
  const todayRef = useRef(saved.current.today);
  const cadenceRef = useRef(0);
  const samples = useRef(0);
  const sampleT = useRef(0);
  const t0 = useRef(performance.now() / 1000);
  const sensor = useRef(null);
  const onStepRef = useRef(null);
  const pedo = useRef(null);

  const persist = useCallback(() => {
    saved.current.today = todayRef.current;
    saved.current.date = todayKey();
    saveFitness(saved.current);
  }, []);

  const onStep = useCallback(
    ({ cadence: spm }) => {
      const key = todayKey();
      if (saved.current.date !== key) {
        saved.current.date = key;
        todayRef.current = 0;
      }
      sessionRef.current += 1;
      todayRef.current += 1;
      cadenceRef.current = spm;
      setSession(sessionRef.current);
      setToday(todayRef.current);
      setCadence(spm);
      setWalking(true);
      persist();
    },
    [persist]
  );

  onStepRef.current = onStep;
  if (!pedo.current) {
    pedo.current = createPedometer({
      onStep: (info) => onStepRef.current && onStepRef.current(info),
    });
  }

  const feed = useCallback((ax, ay, az, includesGravity) => {
    const t = performance.now() / 1000 - t0.current;
    pedo.current.sample(ax, ay, az, t, includesGravity);
    samples.current += 1;
    if (t - sampleT.current >= 1) {
      setHz(samples.current / (t - sampleT.current || 1));
      samples.current = 0;
      sampleT.current = t;
      setWalking(!!pedo.current.bout);
      setCadence(cadenceRef.current);
    }
  }, []);

  const onMotion = useCallback(
    (e) => {
      if (!countingRef.current) return;
      const lin = e.acceleration;
      const g = e.accelerationIncludingGravity;
      if (lin && lin.x != null && (lin.x || lin.y || lin.z)) {
        feed(lin.x, lin.y, lin.z, false);
      } else if (g && g.x != null) {
        feed(g.x, g.y, g.z, true);
      }
    },
    [feed]
  );

  const detach = useCallback(() => {
    window.removeEventListener("devicemotion", onMotion);
    if (sensor.current) {
      try {
        sensor.current.stop();
      } catch {
        /* already stopped */
      }
      sensor.current = null;
    }
  }, [onMotion]);

  const attach = useCallback(async () => {
    detach();
    t0.current = performance.now() / 1000;
    sampleT.current = 0;
    samples.current = 0;
    pedo.current.reset();

    if (typeof Accelerometer !== "undefined") {
      try {
        const acc = new Accelerometer({ frequency: 50 });
        acc.addEventListener("reading", () => {
          if (!countingRef.current) return;
          feed(acc.x || 0, acc.y || 0, acc.z || 0, true);
        });
        acc.start();
        sensor.current = acc;
        return "sensor";
      } catch {
        /* DeviceMotion fallback */
      }
    }

    if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
      const perm = await DeviceMotionEvent.requestPermission();
      if (perm !== "granted") {
        throw new Error("Motion permission denied. Enable it to count steps.");
      }
    }
    if (typeof DeviceMotionEvent === "undefined") {
      throw new Error("This browser has no motion sensors.");
    }
    window.addEventListener("devicemotion", onMotion);
    return "devicemotion";
  }, [detach, feed, onMotion]);

  const stop = useCallback(() => {
    countingRef.current = false;
    setCounting(false);
    setWalking(false);
    detach();
  }, [detach]);

  const start = useCallback(async () => {
    setError("");
    try {
      await attach();
      countingRef.current = true;
      setCounting(true);
      saved.current.auto = true;
      persist();
    } catch (e) {
      countingRef.current = false;
      setCounting(false);
      setError(e.message || "Could not start the pedometer.");
    }
  }, [attach, persist]);

  const resetSession = useCallback(() => {
    sessionRef.current = 0;
    setSession(0);
    setCadence(0);
    pedo.current.reset();
  }, []);

  const resetToday = useCallback(() => {
    sessionRef.current = 0;
    todayRef.current = 0;
    saved.current.today = 0;
    persist();
    setSession(0);
    setToday(0);
    setCadence(0);
    pedo.current.reset();
  }, [persist]);

  const changeStride = useCallback(
    (m) => {
      const v = Math.min(0.95, Math.max(0.5, Number(m) || 0.74));
      setStrideM(v);
      saved.current.strideM = v;
      persist();
    },
    [persist]
  );

  const changeWeight = useCallback(
    (kg) => {
      const v = Math.min(160, Math.max(35, Number(kg) || 65));
      setWeightKg(v);
      saved.current.weightKg = v;
      persist();
    },
    [persist]
  );

  useEffect(() => {
    if (!saved.current.auto) return undefined;
    start();
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => stop(), [stop]);

  return {
    today,
    session,
    counting,
    walking,
    cadence,
    error,
    strideM,
    weightKg,
    goal,
    setGoal: (g) => {
      const v = Math.min(20000, Math.max(2000, Number(g) || 8000));
      setGoal(v);
      saved.current.goal = v;
      persist();
    },
    hz,
    distanceM: stepsToMetres(today, strideM),
    sessionM: stepsToMetres(session, strideM),
    kcal: kcalFromSteps(today, weightKg, strideM),
    start,
    stop,
    resetSession,
    resetToday,
    changeStride,
    changeWeight,
  };
}
