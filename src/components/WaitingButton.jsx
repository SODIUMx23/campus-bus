/**
 * "I'm waiting here" — the student side of the ticket feature.
 *
 * Turns on GPS only while the panel is open, checks the student is actually at
 * the stop, then registers them. Shows how many others are waiting.
 */
import { useEffect, useState } from 'react'
import {
  GEOFENCE_M, ALERT_THRESHOLD, TICKET_TTL_MIN,
  checkProximity, raiseTicket, cancelTicket, useMyPosition, deviceId,
} from '../lib/tickets'

export default function WaitingButton({ stop, waiting }) {
  const [arming, setArming] = useState(false)   // GPS on, checking proximity
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const { pos, error: gpsError } = useMyPosition(arming)

  const mine = waiting?.devices?.includes(deviceId()) ?? false
  const count = waiting?.count ?? 0
  const check = arming ? checkProximity(pos, stop) : null

  // Once registered we no longer need GPS running
  useEffect(() => { if (mine) setArming(false) }, [mine])

  async function submit() {
    if (!check?.ok) return
    setBusy(true); setErr(null)
    try {
      await raiseTicket({ stopId: stop.id, lat: pos.lat, lng: pos.lng, distance: Math.round(check.distance) })
      navigator.vibrate?.(30)
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  async function withdraw() {
    setBusy(true)
    await cancelTicket(stop.id)
    setBusy(false)
  }

  /* ---- already registered ---- */
  if (mine) {
    return (
      <div className="wait wait-on">
        <div className="wait-head">
          <span className="wait-tick">✓</span>
          <div>
            <b>Driver has been told you're here</b>
            <span>{count} waiting at {stop.name} · expires in {TICKET_TTL_MIN} min</span>
          </div>
        </div>
        <button className="wait-cancel" disabled={busy} onClick={withdraw}>
          I've left / cancel
        </button>
      </div>
    )
  }

  /* ---- checking location ---- */
  if (arming) {
    const near = check?.ok
    return (
      <div className={`wait ${near ? 'wait-near' : 'wait-check'}`}>
        <div className="wait-head">
          <span className="wait-spin" />
          <div>
            <b>{!pos ? 'Finding your location…' : near ? `You're at ${stop.name}` : 'Not at the stop yet'}</b>
            <span>
              {gpsError ? gpsError
                : !pos ? 'Allow location access when asked'
                : check.reason === 'inaccurate' ? `GPS too vague (±${Math.round(check.accuracy)} m) — move outdoors`
                : near ? `${Math.round(check.distance)} m away · ±${Math.round(check.accuracy)} m accuracy`
                : `${Math.round(check.distance)} m away — get within ${GEOFENCE_M} m of the stop`}
            </span>
          </div>
        </div>
        <div className="wait-actions">
          <button className="wait-go" disabled={!near || busy} onClick={submit}>
            {busy ? 'Sending…' : near ? "I'm waiting here" : `Move closer`}
          </button>
          <button className="wait-cancel" onClick={() => setArming(false)}>Cancel</button>
        </div>
        {err && <p className="wait-err">{err}</p>}
      </div>
    )
  }

  /* ---- idle ---- */
  return (
    <div className="wait">
      <button className="wait-go" onClick={() => setArming(true)}>
        🙋 I'm waiting at this stop
      </button>
      <p className="wait-note">
        {count > 0
          ? <><b>{count}</b> {count === 1 ? 'person is' : 'people are'} waiting here
              {count >= ALERT_THRESHOLD ? ' · driver alerted' : ` · driver alerted at ${ALERT_THRESHOLD}`}</>
          : <>Tell the driver you're here. You must be within {GEOFENCE_M} m of the stop.</>}
      </p>
    </div>
  )
}
