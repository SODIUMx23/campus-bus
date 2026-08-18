/**
 * CampusMove live server.
 *
 * No dependencies, no database. Holds the current position of every active bus
 * in memory, streams changes to students, and stores the campus definition
 * published from the Map Builder.
 *
 *   POST /api/positions   driver publishes a fix
 *   POST /api/end         driver ends a trip
 *   GET  /api/positions   snapshot of the live fleet
 *   GET  /api/stream      server-sent events
 *   GET  /api/campus      current stops + routes
 *   POST /api/campus      publish stops + routes from the builder
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = process.env.PORT || 8787
const HERE = path.dirname(fileURLToPath(import.meta.url))
const CAMPUS_FILE = path.join(HERE, '..', 'src', 'data', 'campus.geo.json')
const DROP_MS = 3 * 60_000
const TICKET_TTL = 15 * 60_000        // a waiting request expires after 15 min

const fleet = new Map()
const clients = new Set()
/** `${stop_id}:${device_id}` -> waiting request */
const tickets = new Map()

const snapshot = () => [...fleet.values()]

/** Live waiting counts, grouped by stop. */
function ticketSummary() {
  const now = Date.now()
  const byStop = {}
  for (const [key, t] of tickets) {
    if (now - t.created_at > TICKET_TTL) { tickets.delete(key); continue }
    byStop[t.stop_id] ??= { stop_id: t.stop_id, count: 0, oldest: t.created_at, devices: [] }
    const g = byStop[t.stop_id]
    g.count++
    g.oldest = Math.min(g.oldest, t.created_at)
    g.devices.push(t.device_id)
  }
  return Object.values(byStop).sort((a, b) => b.count - a.count)
}

function broadcast() {
  const payload = `data: ${JSON.stringify({ buses: snapshot(), tickets: ticketSummary() })}\n\n`
  for (const res of clients) {
    try { res.write(payload) } catch { clients.delete(res) }
  }
}

setInterval(() => {
  const now = Date.now()
  let changed = false
  for (const [id, r] of fleet) if (now - r.updated_at > DROP_MS) { fleet.delete(id); changed = true }
  const before = tickets.size
  ticketSummary()                        // prunes expired entries as a side effect
  if (changed || tickets.size !== before) broadcast()
}, 15_000)

setInterval(() => {
  for (const res of clients) { try { res.write(': ping\n\n') } catch { clients.delete(res) } }
}, 20_000)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}
const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json', ...CORS })
  res.end(JSON.stringify(body))
}
const readBody = (req) => new Promise((resolve, reject) => {
  let d = ''
  req.on('data', (c) => { d += c; if (d.length > 2e6) reject(new Error('too large')) })
  req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}) } catch (e) { reject(e) } })
  req.on('error', reject)
})

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end() }

  if (url.pathname === '/api/health')
    return json(res, 200, { ok: true, buses: fleet.size, clients: clients.size, waiting: tickets.size })

  /* ---- waiting requests ("I'm at this stop") ---- */

  if (url.pathname === '/api/tickets' && req.method === 'GET')
    return json(res, 200, { stops: ticketSummary(), ttl_ms: TICKET_TTL })

  if (url.pathname === '/api/tickets' && req.method === 'POST') {
    let body
    try { body = await readBody(req) } catch { return json(res, 400, { error: 'bad json' }) }
    const { stop_id, device_id, lat, lng, distance_m } = body
    if (!stop_id || !device_id) return json(res, 400, { error: 'stop_id and device_id required' })

    const key = `${stop_id}:${device_id}`
    const existing = tickets.get(key)
    tickets.set(key, {
      stop_id, device_id, lat, lng, distance_m,
      created_at: existing?.created_at ?? Date.now(),   // don't reset the queue position
      updated_at: Date.now(),
    })
    broadcast()
    return json(res, 200, { ok: true, stops: ticketSummary() })
  }

  if (url.pathname === '/api/tickets/cancel' && req.method === 'POST') {
    let body
    try { body = await readBody(req) } catch { return json(res, 400, { error: 'bad json' }) }
    tickets.delete(`${body.stop_id}:${body.device_id}`)
    broadcast()
    return json(res, 200, { ok: true, stops: ticketSummary() })
  }

  /** Driver reached a stop — everyone waiting there has been picked up. */
  if (url.pathname === '/api/tickets/clear' && req.method === 'POST') {
    let body
    try { body = await readBody(req) } catch { return json(res, 400, { error: 'bad json' }) }
    let cleared = 0
    for (const [key, t] of tickets) {
      if (t.stop_id === body.stop_id) { tickets.delete(key); cleared++ }
    }
    if (cleared) { broadcast(); console.log(`picked up ${cleared} at ${body.stop_id}`) }
    return json(res, 200, { ok: true, cleared })
  }

  if (url.pathname === '/api/campus' && req.method === 'GET') {
    try { return json(res, 200, JSON.parse(fs.readFileSync(CAMPUS_FILE, 'utf8'))) }
    catch { return json(res, 404, { error: 'no campus saved' }) }
  }

  if (url.pathname === '/api/campus' && req.method === 'POST') {
    let body
    try { body = await readBody(req) } catch { return json(res, 400, { error: 'bad json' }) }
    if (!Array.isArray(body.stops) || !Array.isArray(body.routes) || !body.stops.length)
      return json(res, 400, { error: 'need non-empty stops[] and routes[]' })
    try {
      if (fs.existsSync(CAMPUS_FILE)) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        fs.copyFileSync(CAMPUS_FILE, CAMPUS_FILE.replace('.json', `.${stamp}.bak.json`))
      }
    } catch {}
    body.generated = new Date().toISOString()
    fs.writeFileSync(CAMPUS_FILE, JSON.stringify(body, null, 2))
    console.log(`campus published: ${body.stops.length} stops, ${body.routes.length} routes`)
    return json(res, 200, { ok: true, stops: body.stops.length, routes: body.routes.length })
  }

  if (url.pathname === '/api/positions' && req.method === 'GET') return json(res, 200, snapshot())

  if (url.pathname === '/api/positions' && req.method === 'POST') {
    let body
    try { body = await readBody(req) } catch { return json(res, 400, { error: 'bad json' }) }
    const { trip_id, lat, lng, route_id } = body
    if (!trip_id || typeof lat !== 'number' || typeof lng !== 'number' || !route_id)
      return json(res, 400, { error: 'trip_id, route_id, lat, lng required' })
    fleet.set(trip_id, { ...body, updated_at: Date.now() })   // server clock, never the client's
    broadcast()
    return json(res, 200, { ok: true })
  }

  if (url.pathname === '/api/end' && req.method === 'POST') {
    let body
    try { body = await readBody(req) } catch { return json(res, 400, { error: 'bad json' }) }
    if (body.trip_id && fleet.delete(body.trip_id)) broadcast()
    return json(res, 200, { ok: true })
  }

  if (url.pathname === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive', 'X-Accel-Buffering': 'no', ...CORS,
    })
    res.write(`data: ${JSON.stringify({ buses: snapshot(), tickets: ticketSummary() })}\n\n`)
    clients.add(res)
    req.on('close', () => clients.delete(res))
    return
  }

  json(res, 404, { error: 'not found' })
})

server.listen(PORT, '0.0.0.0', () => console.log(`CampusMove live server on :${PORT}`))
