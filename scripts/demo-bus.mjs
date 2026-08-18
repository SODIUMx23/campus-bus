/**
 * Drives a fake bus around the real traced route, publishing to Supabase every
 * 3 seconds — exactly as a driver's phone would. Used to verify the deployed
 * app end to end without needing someone to physically walk the route.
 *
 *   node scripts/demo-bus.mjs [minutes]
 */
import fs from 'node:fs'

const URL_ = 'https://hnjgivmvabtxhrtgghdp.supabase.co'
const KEY = process.env.SUPABASE_ANON_KEY
const MINUTES = Number(process.argv[2] ?? 10)
const TRIP = 'demo-bus'

const campus = JSON.parse(fs.readFileSync(new URL('../src/data/campus.geo.json', import.meta.url)))
const path = campus.routes[0].path
// out and back, so it shuttles like the real service
const loop = [...path, ...path.slice(0, -1).reverse()]

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'resolution=merge-duplicates',
}

let i = 0
const step = 2                     // points advanced per tick
const ticks = (MINUTES * 60) / 3

console.log(`driving ${TRIP} for ${MINUTES} min over ${loop.length} points`)

const timer = setInterval(async () => {
  const [lat, lng] = loop[i % loop.length]
  i += step
  try {
    const r = await fetch(`${URL_}/rest/v1/live_positions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        trip_id: TRIP,
        bus_name: 'Bus 1',
        route_id: campus.routes[0].id,
        lat, lng,
        speed_kmh: 18 + Math.round(Math.random() * 6),
        accuracy_m: 6,
        occupancy: 10 + (i % 20),
        capacity: 45,
        updated_at: new Date().toISOString(),
      }),
    })
    if (!r.ok) console.error('publish failed', r.status, await r.text())
    else process.stdout.write('.')
  } catch (e) { console.error('\n', e.message) }

  if (i / step > ticks) {
    clearInterval(timer)
    await fetch(`${URL_}/rest/v1/live_positions?trip_id=eq.${TRIP}`, { method: 'DELETE', headers })
    console.log('\ndone, bus removed')
    process.exit(0)
  }
}, 3000)
