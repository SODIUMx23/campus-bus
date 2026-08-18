/**
 * Geodesy for a campus-sized area.
 *
 * Everything is done in a local east/north metre frame anchored at the campus
 * centre. Over 1-2 km this is accurate to well under a metre — far tighter than
 * GPS itself — and it means every distance in the app is real metres.
 *
 *   lat/lng  ──toXY──▶  metres (east, north)  ──project──▶  SVG x/y
 */

const M_PER_DEG_LAT = 110574

/** Local planar frame anchored at (lat0, lng0). */
export function makeFrame(lat0, lng0) {
  const mPerDegLng = 111320 * Math.cos((lat0 * Math.PI) / 180)
  return {
    lat0, lng0, mPerDegLng,
    toXY: (lat, lng) => ({
      x: (lng - lng0) * mPerDegLng,   // east, metres
      y: (lat - lat0) * M_PER_DEG_LAT, // north, metres
    }),
    toLatLng: (x, y) => ({
      lat: lat0 + y / M_PER_DEG_LAT,
      lng: lng0 + x / mPerDegLng,
    }),
  }
}

/** Metres between two [lat, lng] points (haversine). */
export function metresBetween(a, b) {
  const dLat = ((b[0] - a[0]) * Math.PI) / 180
  const dLng = ((b[1] - a[1]) * Math.PI) / 180
  const la1 = (a[0] * Math.PI) / 180
  const la2 = (b[0] * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(h))
}

/* ---------------- path measuring, in metres ---------------- */

/** Pre-compute cumulative distance along a [lat,lng][] path. */
export function measurePath(latlngs, frame) {
  const xy = latlngs.map(([la, ln]) => frame.toXY(la, ln))
  const cum = [0]
  for (let i = 1; i < xy.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(xy[i].x - xy[i - 1].x, xy[i].y - xy[i - 1].y))
  }
  return { latlngs, xy, cum, total: cum[cum.length - 1] }
}

/** Position `d` metres along a measured path. Wraps around. */
export function pointAt(measured, d) {
  const { xy, cum, total, latlngs } = measured
  const t = ((d % total) + total) % total
  let i = 1
  while (i < cum.length - 1 && cum[i] < t) i++
  const a = xy[i - 1], b = xy[i]
  const seg = cum[i] - cum[i - 1] || 1
  const f = (t - cum[i - 1]) / seg
  const la = latlngs[i - 1], lb = latlngs[i]
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    lat: la[0] + (lb[0] - la[0]) * f,
    lng: la[1] + (lb[1] - la[1]) * f,
    bearing: (Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI,
  }
}

/** How many metres along the path is the point closest to (lat, lng)? */
export function projectOnPath(measured, lat, lng, frame) {
  const p = frame.toXY(lat, lng)
  const { xy, cum } = measured
  let best = { d: 0, off: Infinity }
  for (let i = 1; i < xy.length; i++) {
    const a = xy[i - 1], b = xy[i]
    const vx = b.x - a.x, vy = b.y - a.y
    const len2 = vx * vx + vy * vy || 1
    let f = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2
    f = Math.max(0, Math.min(1, f))
    const px = a.x + vx * f, py = a.y + vy * f
    const off = Math.hypot(p.x - px, p.y - py)
    if (off < best.off) best = { off, d: cum[i - 1] + Math.hypot(px - a.x, py - a.y) }
  }
  return best
}

/** Forward distance from d to target around a loop of length total. */
export const forwardGap = (d, target, total) => ((target - d) % total + total) % total

/* ---------------- metres → SVG ---------------- */

/** Fit a set of metre-frame points into a w×h viewBox, uniform scale. */
export function makeProjector(xyPoints, { w = 1000, h = 700, pad = 70 } = {}) {
  const minX = Math.min(...xyPoints.map((p) => p.x))
  const maxX = Math.max(...xyPoints.map((p) => p.x))
  const minY = Math.min(...xyPoints.map((p) => p.y))
  const maxY = Math.max(...xyPoints.map((p) => p.y))
  const spanX = Math.max(maxX - minX, 1)
  const spanY = Math.max(maxY - minY, 1)
  const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY) // px per metre
  const offX = (w - spanX * scale) / 2
  const offY = (h - spanY * scale) / 2

  return {
    scale,
    viewBox: { w, h },
    /** metre-frame {x,y} → SVG {x,y} */
    project: (p) => ({
      x: offX + (p.x - minX) * scale,
      y: offY + (maxY - p.y) * scale, // SVG y grows downward
    }),
  }
}

/**
 * Convenience for arbitrary campus data (used by the GPS test page):
 * builds a frame + projector straight from lat/lng, and returns a
 * project(lat, lng) that goes all the way to SVG coordinates.
 */
export function projectorForCampus(campus, opts) {
  const pts = [
    ...campus.stops.map((s) => [s.lat, s.lng]),
    ...campus.routes.flatMap((r) => r.path),
  ]
  if (!pts.length) throw new Error('no points')
  const lat0 = pts.reduce((a, p) => a + p[0], 0) / pts.length
  const lng0 = pts.reduce((a, p) => a + p[1], 0) / pts.length
  const frame = makeFrame(lat0, lng0)
  const proj = makeProjector(pts.map(([la, ln]) => frame.toXY(la, ln)), opts)
  return {
    scale: proj.scale,
    viewBox: proj.viewBox,
    frame,
    project: (lat, lng) => proj.project(frame.toXY(lat, lng)),
  }
}
