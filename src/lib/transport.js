/**
 * Live position transport.
 *
 * Two interchangeable backends behind one interface:
 *   • Supabase  — used in production (Vercel), when env vars are present
 *   • local     — the Node server in server/live-server.mjs, for dev
 *
 *   publish(record)   driver sends a position
 *   end(tripId)       driver goes off duty
 *   subscribe(cb)     receive the whole live fleet whenever it changes
 */
import { supabase, hasSupabase, POSITION_DROP_MS } from './supabase'

export const STALE_MS = 60_000
const POLL_MS = 3000

/* ---------------- shared plumbing ---------------- */

function pollingTransport({ kind, fetchFleet, publish, end }) {
  let latest = []
  const listeners = new Set()
  let started = false

  const emit = () => listeners.forEach((cb) => cb(latest))

  async function tick() {
    try {
      const rows = await fetchFleet()
      if (Array.isArray(rows)) { latest = rows; emit() }
    } catch { /* offline — keep the last known fleet */ }
  }

  return {
    kind, publish, end,
    snapshot: () => latest,
    subscribe(cb) {
      listeners.add(cb)
      cb(latest)
      if (!started) { started = true; tick(); setInterval(tick, POLL_MS) }
      // Re-emit on a timer so "signal lost" badges refresh with no new data.
      const t = setInterval(() => cb(latest), 2000)
      return () => { listeners.delete(cb); clearInterval(t) }
    },
  }
}

/* ---------------- supabase ---------------- */

function supabaseTransport() {
  return pollingTransport({
    kind: 'supabase',

    async fetchFleet() {
      const cutoff = new Date(Date.now() - POSITION_DROP_MS).toISOString()
      const { data, error } = await supabase
        .from('live_positions')
        .select('*')
        .gt('updated_at', cutoff)
      if (error) throw error
      // Normalise to the shape the app expects (ms epoch, not ISO)
      return (data ?? []).map((r) => ({ ...r, updated_at: new Date(r.updated_at).getTime() }))
    },

    async publish(record) {
      const { error } = await supabase.from('live_positions').upsert({
        ...record,
        updated_at: new Date().toISOString(),
      })
      if (error) throw error
    },

    async end(tripId) {
      await supabase.from('live_positions').delete().eq('trip_id', tripId)
    },
  })
}

/* ---------------- local node server ---------------- */

function localTransport() {
  return pollingTransport({
    kind: 'local-server',
    async fetchFleet() {
      const r = await fetch('/api/positions', { cache: 'no-store' })
      if (!r.ok) throw new Error('offline')
      return r.json()
    },
    async publish(record) {
      await fetch('/api/positions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record), keepalive: true,
      })
    },
    end(tripId) {
      return fetch('/api/end', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trip_id: tripId }), keepalive: true,
      }).catch(() => {})
    },
  })
}

export const transport = hasSupabase ? supabaseTransport() : localTransport()

/** Is the backend reachable? Drives the connection dot in the UI. */
export async function pingServer() {
  if (hasSupabase) {
    const { error } = await supabase.from('live_positions').select('trip_id').limit(1)
    if (error) return null
    const { count } = await supabase
      .from('live_positions').select('*', { count: 'exact', head: true })
    return { ok: true, buses: count ?? 0, backend: 'supabase' }
  }
  try {
    const r = await fetch('/api/health', { cache: 'no-store' })
    return r.ok ? await r.json() : null
  } catch { return null }
}
