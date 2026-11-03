const TABLE_NAME = 'calendar_events'
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
    return { url: new URL(`/rest/v1/${TABLE_NAME}`, env.SUPABASE_URL), key }
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

export async function handleCalendarApiA(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (!['GET', 'POST'].includes(request.method)) {
    return json({ error: '不支援此 HTTP 方法。' }, 405)
  }
  const config = getSupabaseConfig(env)
  if (config.error) return config.error
  if (request.method === 'GET') return readEvents(config)
  return createEvent(request, config)
}
