# CampusMove

Live campus shuttle tracking for VIT Vellore.
Driver phones broadcast GPS; students see buses, ETAs, and can signal that
they're waiting at a stop.

## Pages

| Route | Who | What |
|---|---|---|
| `/` | Students | Live map, arrivals board, "I'm waiting here" |
| `/driver` | Drivers | One-tap GPS broadcasting, waiting-passenger alerts |
| `/builder` | Admin | Trace stops and routes over satellite imagery, publish |
| `/gps` | Debug | Proves the same GPS renders on a real map and a custom SVG |

## Features

- Real traced campus geometry, all distances in true metres
- Illustrated SVG map **and** satellite view, same live data
- ETAs that snap GPS to the route line and account for dwell time
- Waiting requests with a 10 m geofence; driver alerted at 5 people
- Installable PWA, offline map tiles

## Run locally

```bash
npm install
node server/live-server.mjs      # live API on :8787
npm run dev                      # app on :5174 (proxies /api)
```

For the installable PWA (service workers need a real build):

```bash
npm run build
npm run preview                  # :5173
```

## Layout

```
src/
  data/campus.geo.json   traced stops + routes (source of truth)
  data/campus.js         derives geometry, loads from /api/campus if available
  lib/geo.js             lat/lng ⇄ metres ⇄ SVG projection, path maths
  lib/transport.js       live position client (SSE + polling fallback)
  lib/tickets.js         waiting requests, geofence
  hooks/useFleet.js      simulated fleet (stand-in until drivers broadcast)
  hooks/useLiveBuses.js  real buses from the server
  components/            maps, waiting UI, install prompt
  pages/Driver.jsx       driver mode
  builder/               map builder
server/live-server.mjs   dependency-free live API
```

## Deployment

Frontend deploys to Vercel as a static build. The live API needs persistent
state, so `server/live-server.mjs` is replaced by Supabase in production —
see `SUPABASE.md`.
