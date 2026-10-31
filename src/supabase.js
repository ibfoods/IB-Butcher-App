import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://gajafjiphrsvztcwofhe.supabase.co'
const supabaseKey = 'sb_publishable_g7JgVrxshCRHFqv4fp2eTw_kxx-zHly'

// The anon key alone can read nothing. After login the app holds a signed
// session token from /api/auth/login; every request carries it and RLS
// decides what that user may do. `supabase` is a live binding — importers
// always see the current client.
const TOKEN_KEY = 'ib_token_v1'
let token = (() => { try { return localStorage.getItem(TOKEN_KEY) || '' } catch { return '' } })()

function build() {
  return createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  })
}
export let supabase = build()

export function setToken(t) {
  token = t || ''
  try { if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY) } catch {}
  supabase = build()
}
export const getToken = () => token

// Decoded claims of the current token (no verification — the server does that)
export function tokenClaims() {
  try { return token ? JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) : null } catch { return null }
}

// fetch() for our own /api routes with the session token attached
export async function api(path, body, method = body === undefined ? 'GET' : 'POST') {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(json.error || `Request failed (${res.status})`), { status: res.status })
  return json
}
