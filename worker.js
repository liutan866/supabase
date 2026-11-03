import { syncEvent } from './notion-sync.js'
import { handleCalendarApiA } from './worker-calendar-a.js'
import { handleCalendarApiB } from './worker-calendar-b.js'
import { handleCalendarApiC } from './worker-calendar-c.js'

const CALENDAR_HANDLERS = new Map([
  ['/api/calendar-events', handleCalendarApiA],
  ['/api/calendar-events-2', handleCalendarApiB],
  ['/api/calendar-events-3', handleCalendarApiC],
])
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
  'Cache-Control': 'no-store',
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function getSupabaseConfig(env, tableName) {
  const key = env.SUPABASE_ANON_KEY || env.SUPABASE_SECRET_KEY
  if (!env.SUPABASE_URL || !key) {
    return { error: json({ error: 'Worker 尚未設定 SUPABASE_URL 或 API Key（SUPABASE_ANON_KEY / SUPABASE_SECRET_KEY）。' }, 500) }
  }
  try {
    return { url: new URL(`/rest/v1/${tableName}`, env.SUPABASE_URL), key }
  } catch {
    return { error: json({ error: 'Worker 的 Supabase URL 設定無效。' }, 500) }
  }
}

async function callSupabase(url, key, options = {}) {
  let response
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        apikey: key,
        Accept: 'application/json',
        ...options.headers,
      },
      signal: AbortSignal.timeout(20000),
    })
  } catch (error) {
    return { error: json({ error: '無法連線至 Supabase。', details: error.message }, 502) }
  }
  if (!response.ok) {
    let details
    try { details = await response.json() } catch {
      details = { message: `Supabase 回應 HTTP ${response.status}` }
    }
    return {
      error: json({
        error: details.message || details.error || 'Supabase 請求失敗。',
        details: details.details,
        code: details.code,
      }, 502),
    }
  }
  return { response }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (['/api/notion/webhook', '/api/notion/backfill'].includes(url.pathname)) {
      return handleNotion(request, env, url)
    }
    const handler = CALENDAR_HANDLERS.get(url.pathname)
    if (!handler) return json({ error: '找不到 API。' }, 404)
    return handler(request, env)
  },
}

async function handleNotion(request, env, url) {
  if (request.method !== 'POST') return json({ error: '請使用 POST。' }, 405)
  if (!env.NOTION_SYNC_SECRET || !env.NOTION_TOKEN || !env.NOTION_DATA_SOURCE_ID) {
    return json({ error: '尚未設定 NOTION_SYNC_SECRET、NOTION_TOKEN 或 NOTION_DATA_SOURCE_ID。' }, 503)
  }
  if (request.headers.get('Authorization') !== `Bearer ${env.NOTION_SYNC_SECRET}`) {
    return json({ error: '同步驗證失敗。' }, 401)
  }
  const config = getSupabaseConfig(env, 'calendar_events')
  if (config.error) return config.error
  let body
  try { body = await request.json() } catch { return json({ error: '請提供 JSON。' }, 400) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: '無效資料。' }, 400)
  try {
    const query = new URL(config.url)
    query.searchParams.set('select', 'id,title,starts_at,ends_at,all_day,location,description')
    const webhook = url.pathname.endsWith('/webhook')
    if (webhook) {
      if (body.schema !== 'public' || body.table !== 'calendar_events' || !['INSERT', 'UPDATE'].includes(body.type) || !body.record?.id) {
        return json({ error: '只接受 public.calendar_events 的 INSERT / UPDATE 通知。' }, 400)
      }
      // Re-read current data rather than applying possibly stale webhook contents.
      query.searchParams.set('id', `eq.${body.record.id}`)
    } else {
      if (body.after !== undefined && (typeof body.after !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(body.after))) {
        return json({ error: '無效的分頁游標。' }, 400)
      }
      query.searchParams.set('order', 'id.asc')
      query.searchParams.set('limit', '5')
      if (body.after) query.searchParams.set('id', `gt.${body.after}`)
    }
    const result = await callSupabase(query, config.key)
    if (result.error) return result.error
    const events = await result.response.json()
    if (!Array.isArray(events)) throw new Error('Supabase 行程格式錯誤。')
    let synced = 0
    for (const event of events) {
      try { await syncEvent(env, event) } catch (error) {
        return json({ error: error.message, synced, failedId: event.id, retryAfter: 5 }, 502)
      }
      synced++
    }
    return json({ synced, next: !webhook && events.length === 5 ? String(events.at(-1).id) : null })
  } catch {
    return json({ error: '同步失敗，請檢查來源資料、連線與 Notion 設定後重試。' }, 502)
  }
}
