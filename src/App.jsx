import { useEffect, useMemo, useState } from 'react'
import CampusMap from './components/CampusMap'
import SatelliteMap from './components/SatelliteMap'
import InstallPrompt from './components/InstallPrompt'
import WaitingButton from './components/WaitingButton'
import StepCounter from './components/StepCounter'
import { useTickets } from './lib/tickets'
import {
  ROUTES, ROUTE_BY_ID, STOPS, STOP_LIST, routesForStop, CAMPUS_NAME,
} from './data/campus'
import { useFleet, etaForStop, TIME_SCALE } from './hooks/useFleet'
import { useLiveBuses } from './hooks/useLiveBuses'
import { useStepCounter } from './hooks/useStepCounter'
import { pingServer } from './lib/transport'
import './App.css'

const fmtEta = (m) => (m < 0.6 ? 'Now' : m < 1.6 ? '1 min' : `${Math.round(m)} min`)

function Clock({ clock }) {
  const total = 7 * 3600 + 30 * 60 + clock
  const hh = String(Math.floor(total / 3600) % 24).padStart(2, '0')
  const mm = String(Math.floor(total / 60) % 60).padStart(2, '0')
  return <span className="clock">{hh}:{mm}</span>
}

export default function App() {
  const [running, setRunning] = useState(true)
  const [view, setView] = useState('illustrated')
  const [selectedRoute, setSelectedRoute] = useState(null)
  const [selectedStop, setSelectedStop] = useState(STOP_LIST[0]?.id ?? null)
  const [selectedBus, setSelectedBus] = useState(null)
  const [userPos, setUserPos] = useState(null)
  const [server, setServer] = useState(null)
  const [sheet, setSheet] = useState('half')     // 'peek' | 'half' | 'full'
  const [showSim, setShowSim] = useState(true)

  const { buses: simBuses, clock } = useFleet(running)
  const liveBuses = useLiveBuses()
  const tickets = useTickets(3000)
  const steps = useStepCounter()
  const buses = [...(showSim ? simBuses : []), ...liveBuses]

  useEffect(() => {
    let alive = true
    const check = async () => { const h = await pingServer(); if (alive) setServer(h) }
    check()
    const t = setInterval(check, 8000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  function locate() {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (p) => setUserPos([p.coords.latitude, p.coords.longitude]),
      () => {},
      { enableHighAccuracy: true, timeout: 15000 }
    )
  }

  const arrivals = useMemo(() => {
    if (!selectedStop) return []
    return buses
      .filter((b) => ROUTE_BY_ID[b.routeId].stopIds.includes(selectedStop))
      .map((b) => ({ bus: b, eta: etaForStop(b, selectedStop) }))
      .filter((a) => a.eta != null)
      .sort((a, b) => a.eta - b.eta)
      .slice(0, 5)
  }, [buses, selectedStop])

  const bus = selectedBus ? buses.find((b) => b.id === selectedBus) : null
  const shown = selectedRoute ? buses.filter((b) => b.routeId === selectedRoute) : buses
  const stop = selectedStop ? STOPS[selectedStop] : null
  const next = arrivals[0]

  const mapProps = {
    buses: shown, selectedRoute, selectedStop, selectedBus, userPos, tickets,
    onSelectStop: (id) => { setSelectedStop(id); setSheet('half') },
    onSelectBus: (id) => { setSelectedBus(id); setSheet('half') },
    onClearSelection: () => setSelectedBus(null),
  }

  const cycleSheet = () => setSheet((s) => (s === 'peek' ? 'half' : s === 'half' ? 'full' : 'peek'))

  return (
    <div className="app">
      <InstallPrompt />

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">🚌</span>
          <span className="brand-text">
            <b>CampusMove</b>
            <small>{CAMPUS_NAME}</small>
          </span>
        </div>

        <div className="topbar-right">
          <Clock clock={clock} />
          <span className={`dot ${server ? 'live' : 'off'}`} title={server ? 'Connected' : 'Offline'} />
          <button className="icon" onClick={locate} title="Find me">📍</button>
          <button className="icon" onClick={() => setView(v => v === 'illustrated' ? 'satellite' : 'illustrated')}
            title="Switch map">{view === 'illustrated' ? '🛰' : '🗺'}</button>
          <details className="menu">
            <summary className="icon">⋯</summary>
            <div className="menu-body">
              <button onClick={() => setRunning(r => !r)}>{running ? 'Pause demo buses' : 'Resume demo buses'}</button>
              <label><input type="checkbox" checked={showSim} onChange={e => setShowSim(e.target.checked)} /> Show demo buses</label>
              <a href="/driver">🚍 Driver mode</a>
              <a href="/builder">🗺 Map builder</a>
            </div>
          </details>
        </div>
      </header>

      <div className="mapwrap">
        {view === 'illustrated' ? <CampusMap {...mapProps} /> : <SatelliteMap {...mapProps} />}
        {liveBuses.length > 0 && (
          <div className="livechip"><span className="pulse" />{liveBuses.length} live</div>
        )}
      </div>

      <section className={`sheet sheet-${sheet}`}>
        <button className="grab" onClick={cycleSheet} aria-label="Resize panel">
          <span />
        </button>

        {/* peek line — always visible */}
        <button className="peekline" onClick={() => setSheet(sheet === 'peek' ? 'half' : 'peek')}>
          <span className="peek-stop">{stop?.name ?? 'Pick a stop'}</span>
          {next
            ? <span className="peek-eta">{fmtEta(next.eta)}</span>
            : <span className="peek-eta dim">—</span>}
        </button>

        <div className="sheet-body">
          <div className="block">
            <div className="blockhead"><h2>Steps</h2></div>
            <StepCounter counter={steps} />
          </div>

          {/* stop + arrivals */}
          {stop && (
            <>
              <div className="block">
                <div className="blockhead">
                  <h2>Next arrivals</h2>
                  <div className="chips">
                    {routesForStop(stop.id).map((r) => (
                      <span key={r.id} className="chip" style={{ background: r.color }}>{r.id}</span>
                    ))}
                  </div>
                </div>
                {arrivals.length === 0
                  ? <p className="empty">No buses heading here right now.</p>
                  : (
                    <ul className="arrivals">
                      {arrivals.map(({ bus: b, eta }) => (
                        <li key={b.id}>
                          <button className={`arrival ${selectedBus === b.id ? 'on' : ''}`}
                            onClick={() => setSelectedBus(b.id)}>
                            <span className="chip" style={{ background: ROUTE_BY_ID[b.routeId].color }}>
                              {b.routeId}
                            </span>
                            <span className="arrival-body">
                              <span className="arrival-name">
                                {b.live && <em className="livetag">LIVE</em>}
                                {b.direction === 'back' ? "to Main Gate" : "to Men's Hostel"}
                              </span>
                              <span className="arrival-meta">
                                {b.occupancy}/{b.capacity} seats
                                {b.delayMin > 1 ? ` · ${Math.round(b.delayMin)} min late` : ''}
                              </span>
                            </span>
                            <span className={`eta ${eta < 1.6 ? 'soon' : ''}`}>{fmtEta(eta)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
              </div>

              <WaitingButton stop={stop} waiting={tickets[stop.id]} />
            </>
          )}

          {/* stop picker */}
          <div className="block">
            <div className="blockhead"><h2>Stops</h2></div>
            <div className="stoppicker">
              {STOP_LIST.map((s) => (
                <button key={s.id}
                  className={`stopchip ${selectedStop === s.id ? 'on' : ''}`}
                  onClick={() => setSelectedStop(s.id)}>
                  {s.name}
                  {tickets[s.id]?.count > 0 && <b className="wbadge">{tickets[s.id].count}</b>}
                </button>
              ))}
            </div>
          </div>

          {/* routes */}
          <div className="block">
            <div className="blockhead">
              <h2>Routes</h2>
              {selectedRoute && <button className="link" onClick={() => setSelectedRoute(null)}>Show all</button>}
            </div>
            <ul className="routes">
              {ROUTES.map((r) => {
                const fleet = buses.filter((b) => b.routeId === r.id)
                const on = selectedRoute === r.id
                return (
                  <li key={r.id}>
                    <button className={`route ${on ? 'on' : ''}`}
                      onClick={() => setSelectedRoute(on ? null : r.id)}>
                      <span className="route-chip" style={{ background: r.color }}>{r.id}</span>
                      <span className="route-body">
                        <span className="route-name">{r.name}</span>
                        <span className="route-meta">
                          {(r.oneWayMetres / 1000).toFixed(2)} km · {r.stopIds.length} stops · {fleet.length} buses
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>

          {/* selected bus */}
          {bus && (
            <div className="block">
              <div className="blockhead">
                <h2>Bus {bus.label}</h2>
                <button className="link" onClick={() => setSelectedBus(null)}>Close</button>
              </div>
              <div className="kv"><span>Route</span><b>{ROUTE_BY_ID[bus.routeId].name}</b></div>
              <div className="kv"><span>Vehicle</span><b>{bus.plate}</b></div>
              <div className="kv"><span>Next stop</span><b>{STOPS[bus.nextStopId]?.name}</b></div>
              <div className="kv"><span>Speed</span><b>{bus.speedKmh.toFixed(0)} km/h</b></div>
              <div className="kv"><span>Position</span><b className="mono">{bus.lat.toFixed(5)}, {bus.lng.toFixed(5)}</b></div>
              <div className="load">
                <div className="load-bar"><span style={{ width: `${(bus.occupancy / bus.capacity) * 100}%` }} /></div>
                <span>{bus.occupancy}/{bus.capacity}</span>
              </div>
            </div>
          )}

          <p className="foot">
            {buses.length} buses{liveBuses.length ? ` · ${liveBuses.length} live GPS` : ''} ·
            demo running at {TIME_SCALE}×
          </p>
        </div>
      </section>
    </div>
  )
}
