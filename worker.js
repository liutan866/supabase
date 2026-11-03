import { syncEvent } from './notion-sync.js'

const API_PATH = '/api/calendar-events'
const PAGE_SIZE = 1000
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
  'Cache-Control': 'no-store',
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function getSupabaseConfig(env) {
  const key = env.SUPABASE_ANON_KEY || env.SUPABASE_SECRET_KEY
  if (!env.SUPABASE_URL || !key) {
    return { error: json({ error: 'Worker 尚未設定 SUPABASE_URL 或 API Key（SUPABASE_ANON_KEY / SUPABASE_SECRET_KEY）。' }, 500) }
  }
  try {
    return { url: new URL('/rest/v1/calendar_events', env.SUPABASE_URL), key }
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

async function readEvents(config) {
  const events = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const url = new URL(config.url)
    url.searchParams.set('select', 'title,starts_at,ends_at,all_day,location,description')
    url.searchParams.set('order', 'starts_at.asc')
    url.searchParams.set('limit', String(PAGE_SIZE))
    const result = await callSupabase(url, config.key, {
      headers: {
        Range: `${offset}-${offset + PAGE_SIZE - 1}`,
        'Range-Unit': 'items',
      },
    })
    if (result.error) return result.error
    let page
    try { page = await result.response.json() } catch {
      return json({ error: 'Supabase 回傳無效的行程資料。' }, 502)
    }
    if (!Array.isArray(page)) return json({ error: 'Supabase 回傳的行程格式錯誤。' }, 502)
    events.push(...page)
    if (page.length < PAGE_SIZE) break
  }
  const now = Date.now()
  const timestamp = event => {
    const time = Date.parse(event.starts_at)
    return Number.isFinite(time) ? time : Infinity
  }
  // Sort after collecting every page so proximity is global, not per page.
  events.sort((a, b) => Math.abs(timestamp(a) - now) - Math.abs(timestamp(b) - now)
    || timestamp(a) - timestamp(b))
  return json({ events })
}

async function createEvent(request, config) {
  let body
  try { body = await request.json() } catch {
    return json({ error: '請提供有效的 JSON 行程資料。' }, 400)
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: '請提供有效的 JSON 行程資料。' }, 400)
  }
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  const startsAt = Date.parse(body?.starts_at)
  const endsAt = Date.parse(body?.ends_at)
  if (!title || title.length > 200) return json({ error: '行程名稱必須為 1 至 200 個字元。' }, 400)
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) {
    return json({ error: '結束時間必須晚於有效的開始時間。' }, 400)
  }
  if (typeof body.all_day !== 'boolean') return json({ error: '全天行程欄位必須為布林值。' }, 400)
  for (const field of ['location', 'description']) {
    if (body[field] !== null && body[field] !== undefined && typeof body[field] !== 'string') {
      return json({ error: `${field} 欄位必須為文字或 null。` }, 400)
    }
  }
  if (typeof body.location === 'string' && body.location.length > 500) {
    return json({ error: '地點不可超過 500 個字元。' }, 400)
  }

  const result = await callSupabase(config.url, config.key, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      title,
      starts_at: new Date(startsAt).toISOString(),
      ends_at: new Date(endsAt).toISOString(),
      all_day: body.all_day,
      location: body.location?.trim() || null,
      description: body.description?.trim() || null,
    }),
  })
  if (result.error) return result.error
  return json({ message: 'Created' }, 201)
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (['/api/notion/webhook', '/api/notion/backfill'].includes(url.pathname)) {
      return handleNotion(request, env, url)
    }
    if (url.pathname !== API_PATH) return json({ error: '找不到 API。' }, 404)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
    if (!['GET', 'POST'].includes(request.method)) {
      return json({ error: '不支援此 HTTP 方法。' }, 405)
    }

    const config = getSupabaseConfig(env)
    if (config.error) return config.error
    if (request.method === 'GET') return readEvents(config)
    return createEvent(request, config)
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
  const config = getSupabaseConfig(env)
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
