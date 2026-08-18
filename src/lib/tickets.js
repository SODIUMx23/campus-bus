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
import { supabase, hasSupabase, TICKET_TTL_MS } from './supabase'

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

/* ---------------- api (supabase in prod, node server in dev) ---------------- */

export async function raiseTicket({ stopId, lat, lng, distance }) {
  const device = deviceId()
  if (hasSupabase) {
    const { error } = await supabase.from('tickets').upsert({
      id: `${stopId}:${device}`,
      stop_id: stopId,
      device_id: device,
      lat, lng, distance_m: distance,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id', ignoreDuplicates: false })
    if (error) throw new Error(error.message)
    return
  }
  const r = await fetch('/api/tickets', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stop_id: stopId, device_id: device, lat, lng, distance_m: distance }),
  })
  if (!r.ok) throw new Error((await r.json()).error ?? 'failed')
}

export async function cancelTicket(stopId) {
  const device = deviceId()
  if (hasSupabase) {
    await supabase.from('tickets').delete().eq('id', `${stopId}:${device}`)
    return
  }
  await fetch('/api/tickets/cancel', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stop_id: stopId, device_id: device }),
  })
}

/** Driver reached a stop — everyone waiting there has boarded. */
export async function clearStop(stopId) {
  if (hasSupabase) {
    await supabase.from('tickets').delete().eq('stop_id', stopId)
    return
  }
  await fetch('/api/tickets/clear', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stop_id: stopId }),
  }).catch(() => {})
}

/** Fetch and group waiting requests by stop. */
async function fetchTickets() {
  if (hasSupabase) {
    const cutoff = new Date(Date.now() - TICKET_TTL_MS).toISOString()
    const { data, error } = await supabase
      .from('tickets').select('*').gt('created_at', cutoff)
    if (error) throw error
    const byStop = {}
    for (const t of data ?? []) {
      const created = new Date(t.created_at).getTime()
      byStop[t.stop_id] ??= { stop_id: t.stop_id, count: 0, oldest: created, devices: [] }
      const g = byStop[t.stop_id]
      g.count++
      g.oldest = Math.min(g.oldest, created)
      g.devices.push(t.device_id)
    }
    return byStop
  }
  const r = await fetch('/api/tickets', { cache: 'no-store' })
  if (!r.ok) throw new Error('offline')
  const d = await r.json()
  return Object.fromEntries((d.stops ?? []).map((s) => [s.stop_id, s]))
}

/** Poll the waiting counts. Returns stop_id -> { count, oldest, devices }. */
export function useTickets(intervalMs = 3000) {
  const [byStop, setByStop] = useState({})

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const d = await fetchTickets()
        if (alive) setByStop(d)
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
