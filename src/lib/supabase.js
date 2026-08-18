/**
 * Supabase client.
 *
 * Configured through Vite env vars set in the Vercel dashboard:
 *   VITE_SUPABASE_URL       https://xxxxx.supabase.co
 *   VITE_SUPABASE_ANON_KEY  eyJhb...
 *
 * If they're absent (local dev), everything falls back to the little Node
 * server in server/live-server.mjs, so both environments keep working.
 */
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const hasSupabase = Boolean(url && key)

export const supabase = hasSupabase
  ? createClient(url, key, {
      auth: { persistSession: false },
      // We poll rather than subscribe: the free tier allows 2M realtime
      // messages/month, and fanning every position out to every student
      // would burn that in a day. Polling costs bandwidth, which is ample.
      realtime: { params: { eventsPerSecond: 1 } },
    })
  : null

/** Rows older than this are treated as gone. */
export const POSITION_STALE_MS = 60_000
export const POSITION_DROP_MS = 3 * 60_000
export const TICKET_TTL_MS = 15 * 60_000

export const backendName = hasSupabase ? 'supabase' : 'local-server'
