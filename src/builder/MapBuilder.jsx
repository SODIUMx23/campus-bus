/**
 * Campus Map Builder
 * ------------------
 * Point-and-click tool to capture the real lat/lng of your campus:
 *   • drop stops on a satellite image of your campus
 *   • trace each bus route along the actual roads
 *   • export data/campus.geo.json, ready to drop into the app or Supabase
 *
 * Everything autosaves to localStorage, so you can close the tab and come back.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  MapContainer, TileLayer, Marker, Polyline, CircleMarker, useMapEvents, useMap,
} from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase, hasSupabase } from '../lib/supabase'
import './builder.css'

const STORAGE = 'campusmove.builder.v1'
const PALETTE = ['#2f7df6', '#f2803c', '#28a17a', '#a855f7', '#e5484d', '#0891b2']

const LAYERS = {
  satellite: {
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles © Esri',
    max: 19,
  },
  google: {
    label: 'Google',
    needsKey: true,
    attribution: 'Imagery ©2026 Google',
    max: 20,
  },
  street: {
    label: 'Street',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
    max: 19,
  },
}

const slug = (s) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'stop'

const round6 = (n) => Math.round(n * 1e6) / 1e6

/** Metres between two lat/lng points (haversine). */
function metres(a, b) {
  const R = 6371000
  const dLat = ((b[0] - a[0]) * Math.PI) / 180
  const dLng = ((b[1] - a[1]) * Math.PI) / 180
  const la1 = (a[0] * Math.PI) / 180
  const la2 = (b[0] * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

const pathLength = (pts) =>
  pts.reduce((sum, p, i) => (i ? sum + metres(pts[i - 1], p) : 0), 0)

const stopIcon = (name, active) =>
  L.divIcon({
    className: '',
    html: `<div class="mk ${active ? 'mk-on' : ''}"><span class="mk-dot"></span><span class="mk-tag">${name}</span></div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  })

/**
 * Google Map Tiles API layer.
 * 100,000 free tiles/month — far more generous than Maps JavaScript ($7/1k loads).
 * Requires a session token, which we mint once and cache.
 */
function GoogleTiles({ apiKey, mapType = 'satellite' }) {
  const [session, setSession] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!apiKey) return
    let alive = true
    const cacheKey = `gtile.session.${mapType}`
    const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null')
    if (cached && cached.expiry * 1000 > Date.now() + 60000) { setSession(cached.session); return }

    fetch(`https://tile.googleapis.com/v1/createSession?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapType, language: 'en-US', region: 'IN', overlay: false }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return
        if (d.session) {
          localStorage.setItem(cacheKey, JSON.stringify(d))
          setSession(d.session)
        } else setErr(d.error?.message || 'Key rejected')
      })
      .catch(() => alive && setErr('Network error'))
    return () => { alive = false }
  }, [apiKey, mapType])

  if (err) return null
  if (!session) return null
  return (
    <TileLayer
      url={`https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${session}&key=${apiKey}`}
      attribution="Imagery ©2026 Google"
      maxNativeZoom={20}
      maxZoom={20}
    />
  )
}

/* ---------------- map interaction ---------------- */

function ClickCapture({ mode, onMapClick }) {
  useMapEvents({ click: (e) => onMapClick([e.latlng.lat, e.latlng.lng]) })
  useEffect(() => {
    const el = document.querySelector('.leaflet-container')
    if (el) el.style.cursor = mode === 'pan' ? '' : 'crosshair'
  }, [mode])
  return null
}

function FlyTo({ target }) {
  const map = useMap()
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], target.zoom ?? 17, { duration: 1.1 })
  }, [target, map])
  return null
}

/* ---------------- search ---------------- */

function Search({ onPick }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function run(e) {
    e.preventDefault()
    if (!q.trim()) return
    setBusy(true); setErr(null); setResults([])
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=6&q=${encodeURIComponent(q)}`,
        { headers: { Accept: 'application/json' } }
      )
      const data = await r.json()
      setResults(data)
      if (!data.length) setErr('No match — try adding the city name.')
    } catch {
      setErr('Search unavailable. Pan the map manually.')
    }
    setBusy(false)
  }

  return (
    <div className="search">
      <form onSubmit={run}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find your campus…" />
        <button disabled={busy}>{busy ? '…' : 'Go'}</button>
      </form>
      {err && <p className="hint warn">{err}</p>}
      {results.length > 0 && (
        <ul className="results">
          {results.map((r) => (
            <li key={r.place_id}>
              <button onClick={() => { onPick({ lat: +r.lat, lng: +r.lon, zoom: 17 }); setResults([]) }}>
                {r.display_name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ---------------- main ---------------- */

export default function MapBuilder() {
  const [state, setState] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE)
      if (saved) return JSON.parse(saved)
    } catch {}
    return {
      center: { lat: 13.0102, lng: 80.2355 }, // Chennai default; search to move it
      stops: [],
      routes: [],
    }
  })
  const [mode, setMode] = useState('stop')       // 'stop' | 'route' | 'pan'
  const [activeRoute, setActiveRoute] = useState(null)
  const [activeStop, setActiveStop] = useState(null)
  const [layer, setLayer] = useState('satellite')
  const [gkey, setGkey] = useState(() => localStorage.getItem('campusmove.gkey') || '')
  const [flyTo, setFlyTo] = useState(null)
  const [toast, setToast] = useState(null)
  const [showJson, setShowJson] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => { localStorage.setItem(STORAGE, JSON.stringify(state)) }, [state])
  useEffect(() => { localStorage.setItem('campusmove.gkey', gkey) }, [gkey])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast])

  const route = state.routes.find((r) => r.id === activeRoute) ?? null

  /* --- keyboard --- */
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT') return
      if (e.key === 's') setMode('stop')
      if (e.key === 'r') setMode('route')
      if (e.key === 'p') setMode('pan')
      if ((e.key === 'z' && (e.metaKey || e.ctrlKey)) || e.key === 'Backspace') {
        e.preventDefault(); undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function undo() {
    if (mode === 'route' && route?.path.length) {
      setState((s) => ({
        ...s,
        routes: s.routes.map((r) => r.id === route.id ? { ...r, path: r.path.slice(0, -1) } : r),
      }))
    } else if (mode === 'stop' && state.stops.length) {
      setState((s) => ({ ...s, stops: s.stops.slice(0, -1) }))
    }
  }

  function handleMapClick(latlng) {
    const pt = [round6(latlng[0]), round6(latlng[1])]
    if (mode === 'stop') {
      const n = state.stops.length + 1
      const name = `Stop ${n}`
      const id = `${slug(name)}_${n}`
      setState((s) => ({ ...s, stops: [...s.stops, { id, name, lat: pt[0], lng: pt[1] }] }))
      setActiveStop(id)
    } else if (mode === 'route' && route) {
      setState((s) => ({
        ...s,
        routes: s.routes.map((r) => r.id === route.id ? { ...r, path: [...r.path, pt] } : r),
      }))
    } else if (mode === 'route' && !route) {
      setToast('Create or select a route first')
    }
  }

  function addRoute() {
    const n = state.routes.length
    const r = {
      id: `R${n + 1}`,
      name: `Route ${n + 1}`,
      color: PALETTE[n % PALETTE.length],
      headway_min: 10,
      path: [],
      stops: [],
    }
    setState((s) => ({ ...s, routes: [...s.routes, r] }))
    setActiveRoute(r.id)
    setMode('route')
  }

  const patchRoute = (id, patch) =>
    setState((s) => ({ ...s, routes: s.routes.map((r) => r.id === id ? { ...r, ...patch } : r) }))

  const patchStop = (id, patch) =>
    setState((s) => ({ ...s, stops: s.stops.map((x) => x.id === id ? { ...x, ...patch } : x) }))

  const delStop = (id) =>
    setState((s) => ({
      ...s,
      stops: s.stops.filter((x) => x.id !== id),
      routes: s.routes.map((r) => ({ ...r, stops: r.stops.filter((x) => x !== id) })),
    }))

  const delRoute = (id) => {
    setState((s) => ({ ...s, routes: s.routes.filter((r) => r.id !== id) }))
    if (activeRoute === id) setActiveRoute(null)
  }

  const toggleRouteStop = (routeId, stopId) => {
    const r = state.routes.find((x) => x.id === routeId)
    const has = r.stops.includes(stopId)
    patchRoute(routeId, { stops: has ? r.stops.filter((x) => x !== stopId) : [...r.stops, stopId] })
  }

  function closeLoop() {
    if (!route || route.path.length < 3) return
    const first = route.path[0]
    const last = route.path[route.path.length - 1]
    if (first[0] === last[0] && first[1] === last[1]) return
    patchRoute(route.id, { path: [...route.path, first] })
    setToast('Loop closed')
  }

  /* --- export --- */
  const payload = useMemo(() => ({
    generated: new Date().toISOString(),
    center: state.center,
    stops: state.stops,
    routes: state.routes.map((r) => ({
      id: r.id, name: r.name, color: r.color,
      headway_min: Number(r.headway_min) || 10,
      stops: r.stops,
      path: r.path,
      length_m: Math.round(pathLength(r.path)),
    })),
  }), [state])

  async function publish() {
    if (!state.stops.length) return setToast('Add some stops first')
    if (!state.routes.some((r) => r.path.length > 1)) return setToast('Trace at least one route')
    setPublishing(true)
    try {
      if (hasSupabase) {
        const { error } = await supabase.from('campus').upsert({
          id: 1, data: payload, updated_at: new Date().toISOString(),
        })
        setToast(error
          ? `Failed: ${error.message}`
          : `Published — ${payload.stops.length} stops, ${payload.routes.length} routes. Reload the app.`)
      } else {
        const r = await fetch('/api/campus', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const d = await r.json()
        setToast(r.ok ? `Published — ${d.stops} stops, ${d.routes} routes. Reload the app.` : `Failed: ${d.error}`)
      }
    } catch (e) { setToast('Publish failed: ' + e.message) }
    setPublishing(false)
  }

  async function copyJson() {
    const text = JSON.stringify(payload, null, 2)
    try {
      await navigator.clipboard.writeText(text)
      setToast('Copied to clipboard — paste it in the chat')
    } catch {
      setShowJson(true)
      setToast('Select all the text and copy it')
    }
  }

  function download(name, text, type = 'application/json') {
    const url = URL.createObjectURL(new Blob([text], { type }))
    const a = document.createElement('a')
    a.href = url; a.download = name; a.click()
    URL.revokeObjectURL(url)
    setToast(`Downloaded ${name}`)
  }

  function exportSql() {
    const esc = (s) => String(s).replace(/'/g, "''")
    const lines = [
      '-- Generated by CampusMove Map Builder',
      'begin;',
      ...state.stops.map((s) =>
        `insert into stops (id, name, lat, lng) values ('${esc(s.id)}', '${esc(s.name)}', ${s.lat}, ${s.lng}) on conflict (id) do update set name = excluded.name, lat = excluded.lat, lng = excluded.lng;`),
      ...state.routes.map((r) =>
        `insert into routes (id, name, color, headway_min, path) values ('${esc(r.id)}', '${esc(r.name)}', '${r.color}', ${Number(r.headway_min) || 10}, '${JSON.stringify(r.path)}'::jsonb) on conflict (id) do update set name = excluded.name, color = excluded.color, headway_min = excluded.headway_min, path = excluded.path;`),
      ...state.routes.flatMap((r) =>
        r.stops.map((sid, i) =>
          `insert into route_stops (route_id, stop_id, seq) values ('${esc(r.id)}', '${esc(sid)}', ${i + 1}) on conflict (route_id, stop_id) do update set seq = excluded.seq;`)),
      'commit;',
    ]
    download('campus.sql', lines.join('\n'), 'text/plain')
  }

  function importJson(e) {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const d = JSON.parse(reader.result)
        setState({
          center: d.center ?? state.center,
          stops: d.stops ?? [],
          routes: (d.routes ?? []).map((r) => ({ headway_min: 10, stops: [], path: [], ...r })),
        })
        setToast('Imported')
      } catch { setToast('Could not read that file') }
    }
    reader.readAsText(f)
    e.target.value = ''
  }

  const totalKm = (state.routes.reduce((s, r) => s + pathLength(r.path), 0) / 1000).toFixed(2)

  return (
    <div className="builder">
      <aside className="bpanel">
        <header className="bhead">
          <h1>Map Builder</h1>
          <a className="link" href="/">← back to app</a>
        </header>

        <Search onPick={(t) => { setFlyTo(t); setState((s) => ({ ...s, center: { lat: t.lat, lng: t.lng } })) }} />

        <div className="modes">
          {[
            ['stop', '📍 Stops', 'S'],
            ['route', '✏️ Route', 'R'],
            ['pan', '🖐 Pan', 'P'],
          ].map(([m, label, key]) => (
            <button key={m} className={`mode ${mode === m ? 'on' : ''}`} onClick={() => setMode(m)}>
              {label}<kbd>{key}</kbd>
            </button>
          ))}
        </div>

        <p className="hint">
          {mode === 'stop' && 'Click the map to drop a stop. Drag any marker to nudge it.'}
          {mode === 'route' && (route
            ? `Clicking adds points to ${route.name}. Trace along the road.`
            : 'Select or create a route below, then click to trace it.')}
          {mode === 'pan' && 'Clicks do nothing — safe to drag and zoom around.'}
          {' '}Backspace undoes.
        </p>

        {/* stops */}
        <section className="bblock">
          <div className="bblock-head">
            <h2>Stops <span className="count">{state.stops.length}</span></h2>
          </div>
          {state.stops.length === 0 && <p className="empty">No stops yet.</p>}
          <ul className="list">
            {state.stops.map((s) => (
              <li key={s.id} className={activeStop === s.id ? 'on' : ''}>
                <input
                  value={s.name}
                  onChange={(e) => patchStop(s.id, { name: e.target.value, id: s.id })}
                  onFocus={() => { setActiveStop(s.id); setFlyTo({ lat: s.lat, lng: s.lng, zoom: 18 }) }}
                />
                <button className="x" onClick={() => delStop(s.id)} title="Delete">×</button>
              </li>
            ))}
          </ul>
        </section>

        {/* routes */}
        <section className="bblock">
          <div className="bblock-head">
            <h2>Routes <span className="count">{state.routes.length}</span></h2>
            <button className="link" onClick={addRoute}>+ add</button>
          </div>
          {state.routes.map((r) => {
            const open = activeRoute === r.id
            return (
              <div key={r.id} className={`rcard ${open ? 'on' : ''}`}>
                <button className="rhead" onClick={() => { setActiveRoute(open ? null : r.id); if (!open) setMode('route') }}>
                  <span className="swatch" style={{ background: r.color }} />
                  <span className="rname">{r.name}</span>
                  <span className="rlen">{(pathLength(r.path) / 1000).toFixed(2)} km · {r.path.length} pts</span>
                </button>
                {open && (
                  <div className="rbody">
                    <div className="row">
                      <input value={r.name} onChange={(e) => patchRoute(r.id, { name: e.target.value })} />
                      <input type="color" value={r.color} onChange={(e) => patchRoute(r.id, { color: e.target.value })} />
                    </div>
                    <div className="row">
                      <label>Every</label>
                      <input className="num" type="number" min="1" value={r.headway_min}
                        onChange={(e) => patchRoute(r.id, { headway_min: e.target.value })} />
                      <label>min</label>
                    </div>
                    <div className="row btns">
                      <button onClick={closeLoop}>Close loop</button>
                      <button onClick={() => patchRoute(r.id, { path: r.path.slice(0, -1) })}>Undo point</button>
                      <button onClick={() => patchRoute(r.id, { path: [] })}>Clear</button>
                      <button className="danger" onClick={() => delRoute(r.id)}>Delete</button>
                    </div>
                    <p className="sub">Stops served (tap in visiting order)</p>
                    <div className="tags">
                      {state.stops.map((s) => {
                        const i = r.stops.indexOf(s.id)
                        return (
                          <button key={s.id} className={`tag ${i >= 0 ? 'on' : ''}`}
                            onClick={() => toggleRouteStop(r.id, s.id)}>
                            {i >= 0 && <b>{i + 1}</b>} {s.name}
                          </button>
                        )
                      })}
                      {state.stops.length === 0 && <span className="empty">Add stops first.</span>}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </section>

        <section className="bblock export">
          <div className="bblock-head"><h2>Export</h2></div>
          <p className="hint">{state.stops.length} stops · {state.routes.length} routes · {totalKm} km traced</p>
          <div className="row btns">
            <button className="primary big" disabled={publishing} onClick={publish}>
              {publishing ? 'Publishing…' : '🚀 Publish to app'}
            </button>
          </div>
          <p className="hint">Sends this map straight to the live app — everyone sees it after a reload.</p>
          <div className="row btns">
            <button onClick={copyJson}>📋 Copy JSON</button>
            <button onClick={() => setShowJson(true)}>Show text</button>
          </div>
          <p className="hint">Downloads are blocked inside the preview — use Copy JSON and paste it into the chat.</p>
          <div className="row btns">
            <button onClick={() => download('campus.geo.json', JSON.stringify(payload, null, 2))}>Download .json</button>
            <button onClick={exportSql}>Download .sql</button>
          </div>
          <div className="row btns">
            <button onClick={() => fileRef.current.click()}>Import JSON</button>
            <button className="danger" onClick={() => { if (confirm('Erase everything?')) setState({ ...state, stops: [], routes: [] }) }}>Reset</button>
          </div>
          <input ref={fileRef} type="file" accept=".json" hidden onChange={importJson} />
        </section>
      </aside>

      <div className="bmap">
        <MapContainer center={[state.center.lat, state.center.lng]} zoom={16} maxZoom={20} className="leaf">
          {layer === 'google'
            ? <GoogleTiles apiKey={gkey} />
            : <TileLayer key={layer} url={LAYERS[layer].url} attribution={LAYERS[layer].attribution}
                maxNativeZoom={LAYERS[layer].max} maxZoom={20} />}
          <ClickCapture mode={mode} onMapClick={handleMapClick} />
          <FlyTo target={flyTo} />

          {state.routes.map((r) => (
            <Polyline key={r.id} positions={r.path} pathOptions={{
              color: r.color,
              weight: activeRoute === r.id ? 6 : 4,
              opacity: !activeRoute || activeRoute === r.id ? 0.95 : 0.35,
            }} />
          ))}

          {route?.path.map((p, i) => (
            <CircleMarker key={i} center={p} radius={4}
              pathOptions={{ color: '#fff', weight: 2, fillColor: route.color, fillOpacity: 1 }} />
          ))}

          {state.stops.map((s) => (
            <Marker key={s.id} position={[s.lat, s.lng]} draggable
              icon={stopIcon(s.name, activeStop === s.id)}
              eventHandlers={{
                click: () => setActiveStop(s.id),
                dragend: (e) => {
                  const { lat, lng } = e.target.getLatLng()
                  patchStop(s.id, { lat: round6(lat), lng: round6(lng) })
                },
              }} />
          ))}
        </MapContainer>

        <div className="layerswitch">
          {Object.entries(LAYERS).map(([k, v]) => (
            <button key={k} className={layer === k ? 'on' : ''} onClick={() => setLayer(k)}>{v.label}</button>
          ))}
        </div>

        {layer === 'google' && !gkey && (
          <div className="gkey">
            <p><b>Google Map Tiles API key</b></p>
            <p className="hint">
              Google Cloud → enable <i>Map Tiles API</i> → create key.
              100,000 tiles/month free. Stored only in this browser.
            </p>
            <input placeholder="AIza…" value={gkey} onChange={(e) => setGkey(e.target.value.trim())} />
            <button onClick={() => setLayer('satellite')}>Use free Esri instead</button>
          </div>
        )}

        {toast && <div className="toast">{toast}</div>}
      </div>

      {showJson && (
        <div className="jmodal" onClick={() => setShowJson(false)}>
          <div className="jbox" onClick={(e) => e.stopPropagation()}>
            <div className="jhead">
              <b>Your campus data</b>
              <div>
                <button onClick={(e) => {
                  const ta = e.currentTarget.closest('.jbox').querySelector('textarea')
                  ta.select(); ta.setSelectionRange(0, 999999)
                  try { document.execCommand('copy'); setToast('Copied') } catch {}
                }}>Select &amp; copy</button>
                <button onClick={() => setShowJson(false)}>Close</button>
              </div>
            </div>
            <p className="hint">Copy everything below and paste it into the chat.</p>
            <textarea readOnly value={JSON.stringify(payload, null, 2)}
              onFocus={(e) => e.target.select()} />
          </div>
        </div>
      )}
    </div>
  )
}
