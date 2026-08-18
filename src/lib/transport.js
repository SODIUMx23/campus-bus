/**
 * Live position transport.
 *
 * Talks to the CampusMove live server on the app's own origin (/api/...), so it
 * behaves the same on localhost, through a tunnel, or in production.
 *
 * Uses SSE when it works and falls back to 2-second polling when it doesn't —
 * some proxies (Cloudflare quick tunnels among them) buffer event streams.
 */

export const STALE_MS = 60_000

function createRemoteTransport() {
  let latest = []
  const listeners = new Set()
  let es = null
  let lastEvent = 0
  let started = false

  const emit = () => listeners.forEach((cb) => cb(latest))
  // /api/positions returns an array; the SSE stream sends { buses, tickets }
  const apply = (data) => {
    const buses = Array.isArray(data) ? data : data?.buses
    if (Array.isArray(buses)) { latest = buses; emit() }
  }

  function connectSSE() {
    try {
      es?.close()
      es = new EventSource('/api/stream')
      es.onmessage = (e) => { lastEvent = Date.now(); try { apply(JSON.parse(e.data)) } catch {} }
      es.onerror = () => { es?.close(); es = null }
    } catch { es = null }
  }

  async function poll() {
    if (Date.now() - lastEvent < 10_000) return   // SSE is healthy, save the request
    try {
      const r = await fetch('/api/positions', { cache: 'no-store' })
      if (r.ok) apply(await r.json())
      if (!es) connectSSE()
    } catch { /* offline — keep the last known fleet */ }
  }

  function start() {
    if (started) return
    started = true
    connectSSE()
    poll()
    setInterval(poll, 2000)
  }

  return {
    kind: 'server',
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
    snapshot: () => latest,
    subscribe(cb) {
      listeners.add(cb)
      cb(latest)
      start()
      const tick = setInterval(() => cb(latest), 2000)  // refresh "stale" badges
      return () => { listeners.delete(cb); clearInterval(tick) }
    },
  }
}

export const transport = createRemoteTransport()

/** Is the live server reachable? Drives the connection pill in the UI. */
export async function pingServer() {
  try {
    const r = await fetch('/api/health', { cache: 'no-store' })
    return r.ok ? await r.json() : null
  } catch { return null }
}
