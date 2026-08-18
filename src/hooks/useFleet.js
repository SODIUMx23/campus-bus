/**
 * Fleet simulation over the *real* traced route.
 *
 * This is a stand-in until driver phones are broadcasting. Every distance and
 * speed below is in real metres / metres-per-second, so the ETAs it produces
 * are genuine minutes — swap in live GPS later and nothing downstream changes.
 */
import { useEffect, useRef, useState } from 'react'
import { ROUTES, ROUTE_BY_ID } from '../data/campus'
import { pointAt, forwardGap } from '../lib/geo'

export const TIME_SCALE = 6          // 1 real second = 6 simulated seconds
const CRUISE_MPS = 20 / 3.6          // 20 km/h on campus roads
const DWELL_SIM_S = 25               // simulated seconds spent at a stop

const PLATES = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const plate = (i) => `TN 23 ${PLATES[i % 24]}${PLATES[(i * 7 + 3) % 24]} ${1000 + i * 137}`

function seedFleet() {
  const buses = []
  let n = 0
  for (const route of ROUTES) {
    const loopMin = route.measured.total / CRUISE_MPS / 60
    const count = Math.max(2, Math.round(loopMin / route.headway))
    for (let i = 0; i < count; i++) {
      n++
      buses.push({
        id: `${route.id}-${i + 1}`,
        routeId: route.id,
        label: `${route.id}·${i + 1}`,
        plate: plate(n),
        d: (route.measured.total / count) * i,
        speedFactor: 0.85 + ((n * 37) % 26) / 100,
        dwellLeft: 0,
        nextStopIdx: 0,
        occupancy: 6 + ((n * 13) % 30),
        capacity: 45,
        delayMin: 0,
      })
    }
  }
  return buses
}

export function useFleet(running = true) {
  const [buses, setBuses] = useState(seedFleet)
  const [clock, setClock] = useState(0)

  useEffect(() => {
    if (!running) return
    let raf
    let last = performance.now()

    const tick = (now) => {
      const dtReal = Math.min(0.1, (now - last) / 1000)
      last = now
      const dtSim = dtReal * TIME_SCALE      // simulated seconds elapsed
      setClock((c) => c + dtSim)

      setBuses((prev) =>
        prev.map((b) => {
          const route = ROUTE_BY_ID[b.routeId]
          const bus = { ...b }

          if (bus.dwellLeft > 0) { bus.dwellLeft -= dtSim; return bus }

          const step = CRUISE_MPS * bus.speedFactor * dtSim   // metres this frame
          const next = route.stopOffsets[bus.nextStopIdx % route.stopOffsets.length]
          const gap = forwardGap(bus.d, next.d, route.measured.total)

          if (gap <= step) {
            bus.d = next.d
            bus.dwellLeft = DWELL_SIM_S
            bus.nextStopIdx = (bus.nextStopIdx + 1) % route.stopOffsets.length
            bus.occupancy = Math.max(0, Math.min(bus.capacity,
              bus.occupancy + Math.round((Math.random() - 0.45) * 9)))
            bus.delayMin = Math.max(-1, Math.min(6, bus.delayMin + (Math.random() - 0.5)))
          } else {
            bus.d = (bus.d + step) % route.measured.total
          }
          return bus
        })
      )
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [running])

  const positioned = buses.map((b) => {
    const route = ROUTE_BY_ID[b.routeId]
    const p = pointAt(route.measured, b.d)
    const next = route.stopOffsets[b.nextStopIdx % route.stopOffsets.length]
    return {
      ...b, ...p,
      nextStopId: next.id,
      direction: route.directionAt(b.d),
      speedKmh: b.dwellLeft > 0 ? 0 : CRUISE_MPS * b.speedFactor * 3.6,
    }
  })

  return { buses: positioned, clock }
}

/** Minutes until `bus` reaches `stopId`, counting dwell at stops on the way. */
export function etaForStop(bus, stopId) {
  const route = ROUTE_BY_ID[bus.routeId]
  const total = route.measured.total
  const targets = route.stopOffsets.filter((s) => s.id === stopId)
  if (!targets.length) return null

  let best = Infinity
  for (const t of targets) {
    const gap = forwardGap(bus.d, t.d, total)
    const between = route.stopOffsets.filter(
      (s) => s.id !== stopId && forwardGap(bus.d, s.d, total) < gap
    ).length
    const seconds =
      gap / (CRUISE_MPS * bus.speedFactor) + between * DWELL_SIM_S + Math.max(0, bus.dwellLeft)
    best = Math.min(best, seconds / 60)
  }
  return best
}
