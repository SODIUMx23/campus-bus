/**
 * Your real campus, derived from data/campus.geo.json (traced in the Map Builder).
 *
 * Open-ended routes are turned into out-and-back loops: the bus drives to the
 * far end, turns around, and comes back. Each stop therefore gets *two* arc
 * positions on the loop — outbound and inbound — which is what makes the ETA
 * board correct in both directions.
 */
import bundled from './campus.geo.json'
import { makeFrame, makeProjector, measurePath, projectOnPath } from '../lib/geo'
import { supabase, hasSupabase } from '../lib/supabase'

/**
 * Campus data comes from the server when reachable (published from the Map
 * Builder), else the copy bundled at build time. Top-level await means
 * everything below is computed from whichever won.
 */
let raw = bundled
try {
  if (hasSupabase) {
    const { data } = await supabase.from('campus').select('data').eq('id', 1).maybeSingle()
    const live = data?.data
    if (live?.stops?.length && live?.routes?.length) raw = live
  } else {
    const res = await fetch('/api/campus', { cache: 'no-store' })
    if (res.ok) {
      const live = await res.json()
      if (live?.stops?.length && live?.routes?.length) raw = live
    }
  }
} catch { /* offline or not set up — bundled copy is fine */ }

export const CAMPUS_SOURCE = raw === bundled ? 'bundled' : 'server'
/** Route colours, kept in the app's purple family for visual consistency. */
const PURPLE_PALETTE = ['#a855f7', '#d946ef', '#8b5cf6', '#c084fc', '#7c3aed', '#e879f9']

export const CAMPUS = { w: 1000, h: 700 }
export const CAMPUS_NAME = 'VIT Vellore'
export const CENTER = raw.center

export const FRAME = makeFrame(raw.center.lat, raw.center.lng)

/** Close an open path by appending its reverse, so buses shuttle back and forth. */
function toLoop(path) {
  const first = path[0]
  const last = path[path.length - 1]
  const closed = first[0] === last[0] && first[1] === last[1]
  if (closed) return { latlngs: path, doubled: false }
  return { latlngs: [...path, ...path.slice(0, -1).reverse()], doubled: true }
}

/* ---- routes ---- */
export const ROUTES = raw.routes.map((r, routeIndex) => {
  const { latlngs, doubled } = toLoop(r.path)
  const measured = measurePath(latlngs, FRAME)
  const oneWay = doubled ? measured.total / 2 : measured.total

  // Where does each stop sit along the loop?
  const oneWayMeasured = measurePath(r.path, FRAME)
  const stopOffsets = []
  for (const sid of r.stops) {
    const s = raw.stops.find((x) => x.id === sid)
    if (!s) continue
    const { d, off } = projectOnPath(oneWayMeasured, s.lat, s.lng, FRAME)
    stopOffsets.push({ id: sid, d, dir: 'out', offMetres: off })
    if (doubled) {
      const back = measured.total - d
      if (Math.abs(back - d) > 5) stopOffsets.push({ id: sid, d: back, dir: 'back', offMetres: off })
    }
  }
  stopOffsets.sort((a, b) => a.d - b.d)

  return {
    id: r.id,
    name: r.name,
    color: PURPLE_PALETTE[routeIndex % PURPLE_PALETTE.length],
    headway: r.headway_min,
    stopIds: r.stops,
    latlngs,
    measured,
    stopOffsets,
    oneWayMetres: Math.round(oneWay),
    doubled,
    /** Direction label for a bus at arc position d. */
    directionAt: (d) => (!doubled ? 'loop' : d < measured.total / 2 ? 'out' : 'back'),
    endpointName: (dir) => {
      const ids = r.stops
      const firstStop = raw.stops.find((x) => x.id === ids[0])
      const lastStop = raw.stops.find((x) => x.id === ids[ids.length - 1])
      // route.stops is in visiting order; outbound heads toward the far end of path
      return dir === 'out' ? lastStop?.name : firstStop?.name
    },
  }
})

export const ROUTE_BY_ID = Object.fromEntries(ROUTES.map((r) => [r.id, r]))

/* ---- projector: fit everything into the SVG viewBox ---- */
const allXY = [
  ...raw.stops.map((s) => FRAME.toXY(s.lat, s.lng)),
  ...ROUTES.flatMap((r) => r.measured.xy),
]
export const PROJ = makeProjector(allXY, { w: CAMPUS.w, h: CAMPUS.h, pad: 80 })

/* ---- stops, with SVG coords baked in ---- */
export const STOPS = Object.fromEntries(
  raw.stops.map((s) => {
    const svg = PROJ.project(FRAME.toXY(s.lat, s.lng))
    return [s.id, { ...s, x: svg.x, y: svg.y }]
  })
)
export const STOP_LIST = Object.values(STOPS)

/** SVG polyline points for a route. */
export const routeSvgPoints = (route) =>
  route.measured.xy.map((p) => {
    const q = PROJ.project(p)
    return `${q.x.toFixed(1)},${q.y.toFixed(1)}`
  }).join(' ')

export const routesForStop = (stopId) => ROUTES.filter((r) => r.stopIds.includes(stopId))

/** Bounds for fitting a Leaflet map. */
export const BOUNDS = (() => {
  const lats = [...raw.stops.map((s) => s.lat), ...ROUTES.flatMap((r) => r.latlngs.map((p) => p[0]))]
  const lngs = [...raw.stops.map((s) => s.lng), ...ROUTES.flatMap((r) => r.latlngs.map((p) => p[1]))]
  return [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]]
})()
