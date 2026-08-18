/**
 * "Add to Home Screen" banner.
 *
 * Chrome/Android fire `beforeinstallprompt`, which we capture and replay when
 * the user taps Install. iOS Safari has no such API, so we show instructions
 * instead. Dismissal is remembered for a week.
 */
import { useEffect, useState } from 'react'

const KEY = 'campusmove.install.dismissed'
const WEEK = 7 * 24 * 60 * 60 * 1000

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState(null)
  const [show, setShow] = useState(false)
  const [iosHelp, setIosHelp] = useState(false)

  useEffect(() => {
    if (isStandalone()) return
    const dismissedAt = +(localStorage.getItem(KEY) || 0)
    if (Date.now() - dismissedAt < WEEK) return

    const onPrompt = (e) => {
      e.preventDefault()
      setDeferred(e)
      setShow(true)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)

    // iOS never fires the event — offer manual instructions after a moment
    let t
    if (isIOS()) t = setTimeout(() => { setIosHelp(true); setShow(true) }, 2500)

    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); clearTimeout(t) }
  }, [])

  function dismiss() {
    localStorage.setItem(KEY, String(Date.now()))
    setShow(false)
  }

  async function install() {
    if (!deferred) return
    deferred.prompt()
    const { outcome } = await deferred.userChoice
    if (outcome === 'accepted') setShow(false)
    else dismiss()
    setDeferred(null)
  }

  if (!show) return null

  return (
    <div className="install">
      <img src="/icon-192.png" alt="" width="44" height="44" />
      <div className="install-body">
        <b>Install CampusMove</b>
        {iosHelp ? (
          <span>Tap <b>Share</b> ⎙ then <b>Add to Home Screen</b></span>
        ) : (
          <span>Add it to your home screen for one-tap access</span>
        )}
      </div>
      {!iosHelp && <button className="install-go" onClick={install}>Install</button>}
      <button className="install-x" onClick={dismiss} aria-label="Dismiss">×</button>
    </div>
  )
}
