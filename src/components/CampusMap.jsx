import { CAMPUS, STOP_LIST, ROUTES, PROJ, FRAME, routeSvgPoints } from '../data/campus'

const toSvg = (b) => PROJ.project({ x: b.x, y: b.y })

function Bus({ bus, route, active, dimmed, onClick }) {
  const p = toSvg(bus)
  const full = bus.occupancy / bus.capacity
  return (
    <g className={`bus ${active ? 'is-active' : ''} ${dimmed ? 'is-dim' : ''}`}
       transform={`translate(${p.x} ${p.y})`}
       onClick={(e) => { e.stopPropagation(); onClick(bus.id) }}>
      {active && <circle r="24" className="bus-halo" style={{ fill: route.color }} />}
      {bus.live && !bus.stale && <circle r="19" className="bus-live" stroke={route.color} />}
      <circle r={bus.live ? 15 : 13} fill="#fff" />
      <circle r={bus.live ? 13 : 11} fill={bus.stale ? '#94a3b8' : route.color} />
      <text className="bus-label" y="3.6">{bus.live ? '●' : bus.routeId}</text>
      {bus.live && <text className="bus-livetag" y="-22">{bus.stale ? 'signal lost' : bus.label}</text>}
      {bus.dwellLeft > 0 && <circle r="15.5" className="bus-dwell" stroke={route.color} />}
      <rect x="-14" y="15" width="28" height="4.5" rx="2.2" fill="rgba(15,23,42,.15)" />
      <rect x="-14" y="15" width={Math.max(2, 28 * full)} height="4.5" rx="2.2"
        fill={full > 0.85 ? '#e5484d' : full > 0.6 ? '#f2803c' : '#28a17a'} />
    </g>
  )
}

export default function CampusMap({
  buses, selectedRoute, selectedStop, selectedBus,
  onSelectStop, onSelectBus, onClearSelection, userPos, tickets = {},
}) {
  const userSvg = userPos ? PROJ.project(FRAME.toXY(userPos[0], userPos[1])) : null

  return (
    <svg className="map" viewBox={`0 0 ${CAMPUS.w} ${CAMPUS.h}`}
      preserveAspectRatio="xMidYMid meet" onClick={onClearSelection}>
      <defs>
        <pattern id="grass" width="28" height="28" patternUnits="userSpaceOnUse">
          <rect width="28" height="28" fill="#0c0c15" />
          <circle cx="7" cy="7" r="1.1" fill="#17172380" />
          <circle cx="21" cy="19" r="1.1" fill="#17172380" />
        </pattern>
      </defs>
      <rect width={CAMPUS.w} height={CAMPUS.h} fill="url(#grass)" />

      {/* road casing under every route */}
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {ROUTES.map((r) => (
          <polyline key={`c${r.id}`} points={routeSvgPoints(r)} stroke="#1b1b28" strokeWidth="22" />
        ))}
        {ROUTES.map((r) => (
          <polyline key={`w${r.id}`} points={routeSvgPoints(r)} stroke="#24243a" strokeWidth="16" />
        ))}
        {ROUTES.map((r) => {
          const on = !selectedRoute || selectedRoute === r.id
          return (
            <polyline key={r.id} points={routeSvgPoints(r)} stroke={r.color}
              strokeWidth={selectedRoute === r.id ? 7 : 5} opacity={on ? 0.95 : 0.14} />
          )
        })}
      </g>

      {/* stops */}
      <g>
        {STOP_LIST.map((s) => {
          const active = selectedStop === s.id
          return (
            <g key={s.id} className={`stop ${active ? 'is-active' : ''}`}
               transform={`translate(${s.x} ${s.y})`}
               onClick={(e) => { e.stopPropagation(); onSelectStop(s.id) }}>
              <circle r="18" className="stop-hit" />
              {active && <circle r="16" className="stop-ring" />}
              <circle r="7.5" fill="#0b0b13" stroke="#ffffff" strokeWidth="3" />
              <circle r="3" fill="#ffffff" />
              <text className="stop-label" y="-21">{s.name}</text>
              {tickets[s.id]?.count > 0 && (
                <g transform="translate(13 -11)">
                  <circle r="9" className="stop-badge" />
                  <text className="stop-badge-text" y="3.5">{tickets[s.id].count}</text>
                </g>
              )}
            </g>
          )
        })}
      </g>

      {buses.map((b) => (
        <Bus key={b.id} bus={b} route={ROUTES.find((r) => r.id === b.routeId)}
          active={selectedBus === b.id}
          dimmed={selectedRoute && selectedRoute !== b.routeId} onClick={onSelectBus} />
      ))}

      {userSvg && (
        <g transform={`translate(${userSvg.x} ${userSvg.y})`}>
          <circle r="16" fill="#d946ef" opacity=".2" className="me-pulse" />
          <circle r="7" fill="#d946ef" stroke="#0b0b13" strokeWidth="3" />
        </g>
      )}

      {/* scale bar — real distance */}
      <g transform={`translate(30 ${CAMPUS.h - 26})`}>
        <line x1="0" y1="0" x2={200 * PROJ.scale} y2="0" stroke="#4a4a63" strokeWidth="3" />
        <line x1="0" y1="-5" x2="0" y2="5" stroke="#4a4a63" strokeWidth="3" />
        <line x1={200 * PROJ.scale} y1="-5" x2={200 * PROJ.scale} y2="5" stroke="#4a4a63" strokeWidth="3" />
        <text x="0" y="-9" className="scale-label">200 m</text>
      </g>
    </svg>
  )
}
