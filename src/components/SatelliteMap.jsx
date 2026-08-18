import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import { useEffect } from 'react'
import 'leaflet/dist/leaflet.css'
import { ROUTES, STOP_LIST, BOUNDS } from '../data/campus'

function Fit() {
  const map = useMap()
  useEffect(() => { map.fitBounds(BOUNDS, { padding: [40, 40] }) }, [map])
  return null
}

export default function SatelliteMap({
  buses, selectedRoute, selectedStop, selectedBus, onSelectStop, onSelectBus, userPos, tickets = {},
}) {
  return (
    <MapContainer className="leafmap" center={[12.9705, 79.1596]} zoom={16} maxZoom={20}>
      <Fit />
      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        attribution="Tiles © Esri" maxNativeZoom={19} maxZoom={20}
      />
      {ROUTES.map((r) => {
        const on = !selectedRoute || selectedRoute === r.id
        return (
          <Polyline key={r.id} positions={r.latlngs}
            pathOptions={{ color: r.color, weight: on ? 6 : 3, opacity: on ? 0.9 : 0.25 }} />
        )
      })}
      {STOP_LIST.map((s) => (
        <CircleMarker key={s.id} center={[s.lat, s.lng]}
          radius={selectedStop === s.id ? 11 : 7}
          pathOptions={{
            color: '#fff', weight: 3,
            fillColor: selectedStop === s.id ? '#a855f7' : '#0b0b13', fillOpacity: 1,
          }}
          eventHandlers={{ click: () => onSelectStop(s.id) }}>
          <Tooltip direction="top" offset={[0, -8]} permanent={selectedStop === s.id || tickets[s.id]?.count > 0}>
            {tickets[s.id]?.count > 0 ? `🙋 ${tickets[s.id].count} · ${s.name}` : s.name}
          </Tooltip>
        </CircleMarker>
      ))}
      {buses.map((b) => {
        const route = ROUTES.find((r) => r.id === b.routeId)
        return (
          <CircleMarker key={b.id} center={[b.lat, b.lng]}
            radius={b.live ? 14 : selectedBus === b.id ? 13 : 10}
            pathOptions={{
              color: b.live ? '#fff' : '#fff',
              weight: b.live ? 4 : 3,
              fillColor: b.stale ? '#94a3b8' : route.color,
              fillOpacity: 1,
              dashArray: b.live ? undefined : '0',
            }}
            eventHandlers={{ click: () => onSelectBus(b.id) }}>
            <Tooltip direction="top" offset={[0, -8]}>
              {b.live ? '🔴 LIVE · ' : ''}{b.label} · {b.occupancy}/{b.capacity}
            </Tooltip>
          </CircleMarker>
        )
      })}
      {userPos && (
        <CircleMarker center={userPos} radius={8}
          pathOptions={{ color: '#fff', weight: 3, fillColor: '#d946ef', fillOpacity: 1 }}>
          <Tooltip direction="top" offset={[0, -8]}>You</Tooltip>
        </CircleMarker>
      )}
    </MapContainer>
  )
}
