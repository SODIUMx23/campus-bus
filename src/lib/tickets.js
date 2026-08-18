/**
 * "I'm waiting here" requests.
 *
 * A student standing at a stop can signal the driver. Two rules keep it honest:
 *   • you must physically be at the stop (geofence, see GEOFENCE_M)
 *   • one request per device per stop
 *
 * The driver is alerted once ALERT_THRESHOLD people are waiting at any stop,
 * and can see the per-stop counts at all times.
 */
import { useEffect, useState } from 'react'
import { metresBetween } from './geo'

export const GEOFENCE_M = 30          // must be this close to the stop
export const ALERT_THRESHOLD = 5      // driver gets an alarm at this many waiting
export const TICKET_TTL_MIN = 15

/** Stable per-browser id, so one phone can't stack requests. */
export function deviceId() {
  let id = localStorage.getItem('campusmove.device')
  if (!id) {
    id = 'd_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
    localStorage.setItem('campusmove.device', id)
  }
  return id
}

/**
 * Can this GPS fix raise a request for `stop`?
 *
 * GPS is never exact, so we forgive up to the reported accuracy (capped at 20 m)
 * — otherwise a perfectly valid fix standing right at the pole gets rejected.
 */
export function checkProximity(pos, stop) {
  if (!pos) return { ok: false, reason: 'no-fix' }
  const distance = metresBetween([pos.lat, pos.lng], [stop.lat, stop.lng])
  const grace = Math.min(pos.accuracy ?? 0, 20)
  if (pos.accuracy > 100) return { ok: false, reason: 'inaccurate', distance, accuracy: pos.accuracy }
  const ok = distance - grace <= GEOFENCE_M
  return { ok, reason: ok ? 'ok' : 'too-far', distance, accuracy: pos.accuracy, grace }
}

/* ---------------- api ---------------- */

export async function raiseTicket({ stopId, lat, lng, distance }) {
  const r = await fetch('/api/tickets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stop_id: stopId, device_id: deviceId(), lat, lng, distance_m: distance }),
  })
  if (!r.ok) throw new Error((await r.json()).error ?? 'failed')
  return r.json()
}

export async function cancelTicket(stopId) {
  await fetch('/api/tickets/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stop_id: stopId, device_id: deviceId() }),
  })
}

export async function clearStop(stopId) {
  await fetch('/api/tickets/clear', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stop_id: stopId }),
  }).catch(() => {})
}

/** Poll the waiting counts. Returns a map of stop_id -> { count, oldest, devices }. */
export function useTickets(intervalMs = 3000) {
  const [byStop, setByStop] = useState({})

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const r = await fetch('/api/tickets', { cache: 'no-store' })
        if (!r.ok) return
        const d = await r.json()
        if (!alive) return
        setByStop(Object.fromEntries((d.stops ?? []).map((s) => [s.stop_id, s])))
      } catch { /* offline */ }
    }
    load()
    const t = setInterval(load, intervalMs)
    return () => { alive = false; clearInterval(t) }
  }, [intervalMs])

  return byStop
}

/** Track this device's own GPS, for the geofence check. */
export function useMyPosition(active) {
  const [pos, setPos] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!active || !navigator.geolocation) return
    setError(null)
    const id = navigator.geolocation.watchPosition(
      (p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => setError(e.code === 1 ? 'Location permission denied' : 'Waiting for GPS…'),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 }
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [active])

  return { pos, error }
}
