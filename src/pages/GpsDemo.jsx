/**
 * Proof: a hand-made map tracking a real GPS device.
 *
 * Loads whatever you traced in the Map Builder, generates an SVG map from
 * those real coordinates, then plots your phone's live GPS on it — alongside
 * a real satellite map showing the identical position.
 *
 * Same lat/lng. Two backdrops. That's the whole point.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { projectorForCampus, metresBetween } from '../lib/geo'
import './gps.css'

const STORAGE = 'campusmove.builder.v1'

/* A tiny fake campus so the page works before you've traced anything. */
const DEMO = {
  center: { lat: 13.0102, lng: 80.2355 },
  stops: [
    { id: 'a', name: 'Main Gate', lat: 13.0088, lng: 80.2372 },
    { id: 'b', name: 'Library',   lat: 13.0108, lng: 80.2350 },
    { id: 'c', name: 'Hostels',   lat: 13.0122, lng: 80.2371 },
    { id: 'd', name: 'Sports',    lat: 13.0104, lng: 80.2392 },
  ],
  routes: [{
    id: 'R1', name: 'Demo Loop', color: '#2f7df6', stops: ['a', 'b', 'c', 'd'],
    path: [
      [13.0088, 80.2372], [13.0094, 80.2358], [13.0108, 80.2350],
      [13.0119, 80.2356], [13.0122, 80.2371], [13.0114, 80.2388],
      [13.0104, 80.2392], [13.0094, 80.2385], [13.0088, 80.2372],
    ],
  }],
}

function Recenter({ pos }) {
  const map = useMap()
  useEffect(() => { if (pos) map.setView(pos, map.getZoom()) }, [pos, map])
  return null
}

export default function GpsDemo() {
  const [campus, setCampus] = useState(DEMO)
  const [usingDemo, setUsingDemo] = useState(true)
  const [pos, setPos] = useState(null)          // [lat, lng]
  const [acc, setAcc] = useState(null)
  const [err, setErr] = useState(null)
  const [tracking, setTracking] = useState(false)
  const [trail, setTrail] = useState([])
  const watch = useRef(null)

  // Load whatever the builder saved
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE)
      if (!raw) return
      const d = JSON.parse(raw)
      if (d.stops?.length || d.routes?.some((r) => r.path.length)) {
        setCampus({ ...d, routes: d.routes.filter((r) => r.path.length > 1) })
        setUsingDemo(false)
      }
    } catch {}
  }, [])

  const proj = useMemo(() => {
    try { return projectorForCampus(campus, { w: 1000, h: 700, pad: 70 }) }
    catch { return null }
  }, [campus])

  function start() {
    if (!navigator.geolocation) return setErr('This browser has no geolocation.')
    setErr(null); setTracking(true)
    watch.current = navigator.geolocation.watchPosition(
      (p) => {
        const next = [p.coords.latitude, p.coords.longitude]
        setPos(next); setAcc(p.coords.accuracy)
        setTrail((t) => (t.length && metresBetween(t[t.length - 1], next) < 3 ? t : [...t, next].slice(-300)))
      },
      (e) => { setErr(e.message); setTracking(false) },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 }
    )
  }

  function stop() {
    navigator.geolocation.clearWatch(watch.current)
    setTracking(false)
  }

  useEffect(() => () => watch.current && navigator.geolocation.clearWatch(watch.current), [])

  const svgPos = pos && proj ? proj.project(pos[0], pos[1]) : null
  const svgTrail = proj ? trail.map(([la, ln]) => proj.project(la, ln)) : []
  // Is the GPS fix anywhere near the traced campus?
  const offMap = svgPos && (svgPos.x < -200 || svgPos.x > 1200 || svgPos.y < -200 || svgPos.y > 900)

  return (
    <div className="gps">
      <header className="gtop">
        <div>
          <h1>Same GPS, two maps</h1>
          <p>
            {usingDemo
              ? 'Showing a demo campus — trace yours in the Map Builder and it appears here.'
              : `Your traced campus · ${campus.stops.length} stops · ${campus.routes.length} routes`}
          </p>
        </div>
        <div className="gactions">
          <a className="gbtn ghost" href="/builder">Map Builder</a>
          <a className="gbtn ghost" href="/">App</a>
          <button className={`gbtn ${tracking ? 'stop' : ''}`} onClick={tracking ? stop : start}>
            {tracking ? 'Stop' : 'Use my GPS'}
          </button>
        </div>
      </header>

      <div className="gbar">
        {err && <span className="bad">⚠ {err}</span>}
        {!err && !pos && <span className="muted">Press “Use my GPS”, then allow location. Works best outdoors.</span>}
        {pos && (
          <>
            <code>{pos[0].toFixed(6)}, {pos[1].toFixed(6)}</code>
            <span className="sep" />
            <span className={acc > 50 ? 'bad' : acc > 20 ? 'warn' : 'good'}>±{Math.round(acc)} m</span>
            <span className="sep" />
            <span className="muted">{trail.length} points logged</span>
            {offMap && <><span className="sep" /><span className="warn">You’re outside the traced area</span></>}
          </>
        )}
      </div>

      <div className="gsplit">
        {/* ---- real satellite ---- */}
        <section className="gpane">
          <h2>Real satellite map</h2>
          <MapContainer center={pos ?? [campus.center.lat, campus.center.lng]} zoom={17} className="gleaf">
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              attribution="Tiles © Esri" maxNativeZoom={19} maxZoom={20}
            />
            {campus.routes.map((r) => (
              <Polyline key={r.id} positions={r.path} pathOptions={{ color: r.color, weight: 5 }} />
            ))}
            {campus.stops.map((s) => (
              <CircleMarker key={s.id} center={[s.lat, s.lng]} radius={6}
                pathOptions={{ color: '#fff', weight: 2, fillColor: '#1e293b', fillOpacity: 1 }} />
            ))}
            {trail.length > 1 && <Polyline positions={trail} pathOptions={{ color: '#e5484d', weight: 3, dashArray: '5 5' }} />}
            {pos && <CircleMarker center={pos} radius={9}
              pathOptions={{ color: '#fff', weight: 3, fillColor: '#e5484d', fillOpacity: 1 }} />}
            {pos && <Recenter pos={pos} />}
          </MapContainer>
        </section>

        {/* ---- generated SVG ---- */}
        <section className="gpane">
          <h2>Your own SVG map <em>— generated from the same coordinates</em></h2>
          <div className="gsvgwrap">
            {proj ? (
              <svg viewBox="0 0 1000 700" className="gsvg">
                <rect width="1000" height="700" fill="#eef4ec" />

                {campus.routes.map((r) => (
                  <polyline key={r.id} fill="none" stroke={r.color} strokeWidth="8"
                    strokeLinejoin="round" strokeLinecap="round"
                    points={r.path.map(([la, ln]) => { const p = proj.project(la, ln); return `${p.x},${p.y}` }).join(' ')} />
                ))}

                {campus.stops.map((s) => {
                  const p = proj.project(s.lat, s.lng)
                  return (
                    <g key={s.id} transform={`translate(${p.x} ${p.y})`}>
                      <circle r="8" fill="#fff" stroke="#334155" strokeWidth="3" />
                      <circle r="3" fill="#334155" />
                      <text y="-16" className="gsvg-label">{s.name}</text>
                    </g>
                  )
                })}

                {svgTrail.length > 1 && (
                  <polyline fill="none" stroke="#e5484d" strokeWidth="3" strokeDasharray="6 6"
                    points={svgTrail.map((p) => `${p.x},${p.y}`).join(' ')} />
                )}

                {svgPos && !offMap && (
                  <g transform={`translate(${svgPos.x} ${svgPos.y})`}>
                    <circle r={Math.max(10, (acc ?? 10) * proj.scale)} fill="#e5484d" opacity=".15" />
                    <circle r="14" fill="#e5484d" opacity=".25" className="gpulse" />
                    <circle r="9" fill="#e5484d" stroke="#fff" strokeWidth="3" />
                    <text y="-22" className="gsvg-label">You</text>
                  </g>
                )}

                {/* scale bar */}
                <g transform="translate(30 660)">
                  <line x1="0" y1="0" x2={100 * proj.scale} y2="0" stroke="#475569" strokeWidth="3" />
                  <text x="0" y="-7" className="gsvg-scale">100 m</text>
                </g>
              </svg>
            ) : (
              <p className="muted pad">Trace at least one stop or route in the Map Builder.</p>
            )}
          </div>
        </section>
      </div>

      <footer className="gfoot">
        The red dot is one pair of numbers from your phone’s GPS chip, drawn twice.
        The satellite map is a picture from Esri; the SVG is a picture generated from your traced
        coordinates. Neither one produced the position — the phone did.
      </footer>
    </div>
  )
}
