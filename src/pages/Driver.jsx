/**
 * Driver mode.
 *
 * Pick a route, hit START, and this phone becomes a bus: its GPS is read every
 * few seconds and published for students to see. Designed to be operated by
 * someone glancing at it in sunlight — two big buttons, honest status.
 */
import { useEffect, useRef, useState } from 'react'
import { ROUTES, ROUTE_BY_ID, STOPS, FRAME } from '../data/campus'
import { projectOnPath, forwardGap, metresBetween } from '../lib/geo'
import { transport, pingServer } from '../lib/transport'
import { backendName } from '../lib/supabase'
import WaitingPanel from '../components/WaitingPanel'
import './driver.css'

const PUSH_MS = 3000        // how often we send a position
const MAX_ACCURACY = 100    // metres — reject anything vaguer than this
const BUSES = ['Bus 1', 'Bus 2', 'Bus 3', 'Bus 4']

const uid = () => Math.random().toString(36).slice(2, 10)

export default function Driver() {
  const [routeId, setRouteId] = useState(ROUTES[0]?.id ?? '')
  const [busName, setBusName] = useState(BUSES[0])
  const [trip, setTrip] = useState(null)
  const [fix, setFix] = useState(null)      // latest GPS reading
  const [sent, setSent] = useState(0)
  const [error, setError] = useState(null)
  const [occupancy, setOccupancy] = useState(12)
  const [server, setServer] = useState('checking')
  const [pubError, setPubError] = useState(null)

  const watchId = useRef(null)
  const wakeLock = useRef(null)
  const lastPush = useRef(0)
  const tripRef = useRef(null)
  tripRef.current = trip

  const route = ROUTE_BY_ID[routeId]

  useEffect(() => {
    let alive = true
    const check = async () => {
      const h = await pingServer()
      if (alive) setServer(h ? `online · ${h.buses} bus${h.buses === 1 ? '' : 'es'}, ${h.clients} watching` : 'offline')
    }
    check()
    const t = setInterval(check, 8000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  /* ---------- lifecycle ---------- */

  async function start() {
    if (!navigator.geolocation) return setError('This browser has no GPS support.')
    if (!window.isSecureContext) {
      return setError('GPS needs HTTPS. Open this page over https:// (or localhost).')
    }

    const t = { id: uid(), routeId, busName, startedAt: Date.now() }
    setTrip(t)
    setError(null)
    setSent(0)

    try {
      wakeLock.current = await navigator.wakeLock?.request('screen')
    } catch { /* not supported — the driver must disable auto-lock manually */ }

    watchId.current = navigator.geolocation.watchPosition(
      (pos) => onFix(pos),
      (err) => setError(err.message),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 }
    )
  }

  function end() {
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current)
    watchId.current = null
    wakeLock.current?.release?.()
    wakeLock.current = null
    if (tripRef.current) transport.end(tripRef.current.id)
    setTrip(null)
    setFix(null)
  }

  function onFix(pos) {
    const { latitude, longitude, accuracy, speed, heading } = pos.coords
    const t = tripRef.current
    if (!t) return

    const r = ROUTE_BY_ID[t.routeId]
    const snap = projectOnPath(r.measured, latitude, longitude, FRAME)

    setFix({ lat: latitude, lng: longitude, accuracy, speed, heading, snap, at: Date.now() })

    if (accuracy > MAX_ACCURACY) return          // too vague, don't publish
    const now = Date.now()
    if (now - lastPush.current < PUSH_MS) return // throttle
    lastPush.current = now

    transport.publish({
      trip_id: t.id,
      bus_name: t.busName,
      route_id: t.routeId,
      lat: latitude,
      lng: longitude,
      speed_kmh: speed != null ? Math.max(0, speed * 3.6) : null,
      heading,
      accuracy_m: accuracy,
      occupancy,
      capacity: 45,
      d: snap.d,
    })
      .then(() => { setSent((n) => n + 1); setPubError(null) })
      .catch((e) => setPubError(e.message ?? 'publish failed'))
  }

  // Clean up if the tab closes or the component unmounts
  useEffect(() => {
    const bye = () => { if (tripRef.current) transport.end(tripRef.current.id) }
    window.addEventListener('pagehide', bye)
    return () => { window.removeEventListener('pagehide', bye); bye() }
  }, [])

  /* ---------- derived readouts ---------- */

  let nextStop = null
  let toNext = null
  let onRoute = null

  if (fix && route) {
    onRoute = fix.snap.off        // metres from the traced line
    const total = route.measured.total
    let best = Infinity
    for (const s of route.stopOffsets) {
      const gap = forwardGap(fix.snap.d, s.d, total)
      if (gap < best) { best = gap; nextStop = STOPS[s.id] }
    }
    toNext = best
  }

  const accClass = !fix ? '' : fix.accuracy > 50 ? 'bad' : fix.accuracy > 20 ? 'warn' : 'good'
  const running = !!trip

  return (
    <div className={`drv ${running ? 'on' : ''}`}>
      <header className="dtop">
        <div>
          <h1>Driver mode</h1>
          <p>{running ? `${busName} · ${route?.name}` : 'Not on duty'}</p>
          <p className={`dsrv ${server.startsWith('online') ? 'ok' : server === 'checking' ? '' : 'no'}`}>
            {backendName} · {server}
          </p>
        </div>
        <a className="dlink" href="/">Student view</a>
      </header>

      <main className="dmain">
        {!running ? (
          <>
            <label className="dfield">
              <span>Route</span>
              <select value={routeId} onChange={(e) => setRouteId(e.target.value)}>
                {ROUTES.map((r) => <option key={r.id} value={r.id}>{r.id} — {r.name}</option>)}
              </select>
            </label>

            <label className="dfield">
              <span>Bus</span>
              <select value={busName} onChange={(e) => setBusName(e.target.value)}>
                {BUSES.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>

            <WaitingPanel route={route} busD={null} running={false} />

            <button className="dbig go" onClick={start}>START TRIP</button>
            <p className="dnote">
              Keep this screen on and the phone plugged in. Allow location when asked.
            </p>
          </>
        ) : (
          <>
            <div className="dstat">
              <div className="dstat-main">
                {fix ? `${(fix.speed ? fix.speed * 3.6 : 0).toFixed(0)}` : '--'}
                <small>km/h</small>
              </div>
              <div className="dstat-side">
                <div><b className={accClass}>{fix ? `±${Math.round(fix.accuracy)} m` : 'waiting…'}</b><span>GPS accuracy</span></div>
                <div><b>{sent}</b><span>updates sent</span></div>
              </div>
            </div>

            <div className="dcards">
              <div className="dcard">
                <span>Next stop</span>
                <b>{nextStop ? nextStop.name : '—'}</b>
                {toNext != null && <em>{toNext < 1000 ? `${Math.round(toNext)} m away` : `${(toNext / 1000).toFixed(2)} km away`}</em>}
              </div>
              <div className="dcard">
                <span>On route</span>
                <b className={onRoute == null ? '' : onRoute < 30 ? 'good' : onRoute < 80 ? 'warn' : 'bad'}>
                  {onRoute == null ? '—' : onRoute < 30 ? 'Yes' : `${Math.round(onRoute)} m off`}
                </b>
                <em>distance from traced line</em>
              </div>
            </div>

            <label className="dfield">
              <span>How full is the bus? <b>{occupancy}/45</b></span>
              <input type="range" min="0" max="45" value={occupancy}
                onChange={(e) => setOccupancy(+e.target.value)} />
            </label>

            {fix && (
              <p className="dcoords">
                {fix.lat.toFixed(6)}, {fix.lng.toFixed(6)}
              </p>
            )}

            <WaitingPanel route={route} busD={fix?.snap?.d} running={running} />

            <button className="dbig stop" onClick={end}>END TRIP</button>
          </>
        )}

        {error && <p className="derr">⚠ {error}</p>}
        {pubError && <p className="derr">⚠ Could not send position: {pubError}</p>}

        {!running && (
          <div className="dhow">
            <h3>How to test this</h3>
            <ol>
              <li>Open this page on your <b>phone</b>, over https.</li>
              <li>Press START TRIP and allow location.</li>
              <li>Open the <b>student view</b> in another tab — your bus appears.</li>
              <li>Walk along the route and watch it move.</li>
            </ol>
            <p className="dnote">
              Right now positions are shared between tabs on this device only.
              Connecting Supabase makes them visible to every phone.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
