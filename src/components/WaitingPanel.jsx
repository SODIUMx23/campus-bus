/**
 * Waiting-passenger panel for the driver.
 *
 * Shows a live count per stop, sorted by how soon the bus reaches each one, and
 * raises a loud alert the moment any stop hits ALERT_THRESHOLD. Also clears a
 * stop automatically once the bus actually arrives there.
 */
import { useEffect, useRef, useState } from 'react'
import { STOPS } from '../data/campus'
import { ALERT_THRESHOLD, GEOFENCE_M, useTickets, clearStop } from '../lib/tickets'
import { forwardGap } from '../lib/geo'

/** Short beep via WebAudio — no asset to load, works offline. */
function beep(times = 3) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    for (let i = 0; i < times; i++) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.frequency.value = 880
      osc.type = 'sine'
      const t = ctx.currentTime + i * 0.28
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22)
      osc.start(t); osc.stop(t + 0.24)
    }
    setTimeout(() => ctx.close(), times * 300 + 400)
  } catch {}
}

export default function WaitingPanel({ route, busD, running }) {
  const byStop = useTickets(3000)
  const [alerted, setAlerted] = useState(null)     // stop currently alarming
  const seen = useRef(new Set())                   // stops already alerted this trip
  const clearedRecently = useRef(new Map())

  const entries = Object.values(byStop)

  /* ---- alert when a stop crosses the threshold ---- */
  useEffect(() => {
    for (const t of entries) {
      if (t.count >= ALERT_THRESHOLD && !seen.current.has(t.stop_id)) {
        seen.current.add(t.stop_id)
        setAlerted({ stopId: t.stop_id, count: t.count })
        beep(3)
        navigator.vibrate?.([220, 120, 220, 120, 220])
      }
      // let it re-alert if the crowd clears and builds again
      if (t.count < ALERT_THRESHOLD) seen.current.delete(t.stop_id)
    }
    for (const id of [...seen.current]) {
      if (!byStop[id]) seen.current.delete(id)
    }
  }, [byStop, running]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- auto-clear a stop once the bus is actually there ---- */
  useEffect(() => {
    if (!running || busD == null || !route) return
    for (const s of route.stopOffsets) {
      const gap = Math.min(
        forwardGap(busD, s.d, route.measured.total),
        forwardGap(s.d, busD, route.measured.total)
      )
      if (gap < 25 && byStop[s.id]) {
        const last = clearedRecently.current.get(s.id) ?? 0
        if (Date.now() - last > 60_000) {
          clearedRecently.current.set(s.id, Date.now())
          clearStop(s.id)
          if (alerted?.stopId === s.id) setAlerted(null)
        }
      }
    }
  }, [busD, byStop, route, running, alerted])

  /* ---- order stops by how soon we reach them ---- */
  const ordered = entries
    .map((t) => {
      const off = route?.stopOffsets.find((s) => s.id === t.stop_id)
      const ahead = off && busD != null
        ? forwardGap(busD, off.d, route.measured.total)
        : Infinity
      return { ...t, ahead, name: STOPS[t.stop_id]?.name ?? t.stop_id }
    })
    .sort((a, b) => a.ahead - b.ahead)

  const total = ordered.reduce((n, t) => n + t.count, 0)

  return (
    <>
      {alerted && (
        <div className="alertbar" role="alert">
          <div>
            <b>{alerted.count} students waiting</b>
            <span>{STOPS[alerted.stopId]?.name ?? alerted.stopId}</span>
          </div>
          <button onClick={() => setAlerted(null)}>Got it</button>
        </div>
      )}

      <section className="dwaiting">
        <header>
          <h3>Waiting passengers</h3>
          <span className={total ? 'hot' : ''}>{total}</span>
        </header>

        {ordered.length === 0 ? (
          <p className="dnote" style={{ textAlign: 'left' }}>
            Nobody has signalled yet. Students within {GEOFENCE_M} m of a stop can tap
            “I’m waiting here”, and you’ll be alerted at {ALERT_THRESHOLD}.
          </p>
        ) : (
          <ul>
            {ordered.map((t) => (
              <li key={t.stop_id} className={t.count >= ALERT_THRESHOLD ? 'hot' : ''}>
                <span className="wcount">{t.count}</span>
                <span className="wbody">
                  <b>{t.name}</b>
                  <em>
                    {t.ahead === Infinity ? 'not on this route'
                      : t.ahead < 1000 ? `${Math.round(t.ahead)} m ahead`
                      : `${(t.ahead / 1000).toFixed(2)} km ahead`}
                    {' · longest wait '}
                    {Math.max(1, Math.round((Date.now() - t.oldest) / 60000))} min
                  </em>
                </span>
                <button className="wclear" onClick={() => clearStop(t.stop_id)} title="Mark as picked up">
                  ✓
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
