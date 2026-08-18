/**
 * Real buses, from the transport layer.
 *
 * Shapes each record to look exactly like a simulated bus, so the map and the
 * arrivals board don't need to care which is which — they just get a `live`
 * flag and a `stale` flag.
 */
import { useEffect, useState } from 'react'
import { transport, STALE_MS } from '../lib/transport'
import { ROUTE_BY_ID, FRAME } from '../data/campus'
import { projectOnPath } from '../lib/geo'

export function useLiveBuses() {
  const [raw, setRaw] = useState([])

  useEffect(() => transport.subscribe(setRaw), [])

  return raw
    .filter((r) => ROUTE_BY_ID[r.route_id])
    .map((r) => {
      const route = ROUTE_BY_ID[r.route_id]
      const d = r.d ?? projectOnPath(route.measured, r.lat, r.lng, FRAME).d
      const xy = FRAME.toXY(r.lat, r.lng)
      return {
        id: r.trip_id,
        live: true,
        stale: Date.now() - r.updated_at > STALE_MS,
        routeId: r.route_id,
        label: r.bus_name ?? 'Bus',
        plate: 'live GPS',
        lat: r.lat,
        lng: r.lng,
        x: xy.x,
        y: xy.y,
        d,
        speedKmh: r.speed_kmh ?? 0,
        speedFactor: 1,
        dwellLeft: 0,
        occupancy: r.occupancy ?? 0,
        capacity: r.capacity ?? 45,
        delayMin: 0,
        accuracy: r.accuracy_m,
        direction: route.directionAt(d),
        nextStopId: (() => {
          const total = route.measured.total
          let best = Infinity, id = route.stopOffsets[0]?.id
          for (const s of route.stopOffsets) {
            const gap = ((s.d - d) % total + total) % total
            if (gap < best) { best = gap; id = s.id }
          }
          return id
        })(),
      }
    })
}
