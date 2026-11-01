// Supabase remains the source of truth. No Notion credentials reach the browser.
export function notionProperties(event, timeZone = 'Asia/Taipei') {
  const start = new Date(event.starts_at)
  const end = new Date(event.ends_at)
  if (!event.id || !event.title || !Number.isFinite(+start) || !Number.isFinite(+end) || end <= start) {
    throw new Error('行程缺少 ID、名稱或有效的起訖時間。')
  }
  const dateOnly = date => new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
  const richText = value => {
    const text = String(value || '')
    if (text.length > 200000) throw new Error('行程文字超過 Notion 欄位上限。')
    return Array.from({ length: Math.ceil(text.length / 2000) }, (_, index) => ({
      text: { content: text.slice(index * 2000, (index + 1) * 2000) },
    }))
  }
  return {
    '行程名稱': { title: richText(event.title) },
    '行程時間': { date: event.all_day
      ? { start: dateOnly(start), end: dateOnly(new Date(+end - 1)) }
      : { start: start.toISOString(), end: end.toISOString() } },
    '全天': { checkbox: Boolean(event.all_day) },
    '地點': { rich_text: richText(event.location) },
    '備註': { rich_text: richText(event.description) },
    'Supabase ID': { rich_text: richText(event.id) },
  }
}

async function notion(env, path, body, method = 'POST') {
  // Keep sequential backfills below Notion's average request rate.
  await new Promise(resolve => setTimeout(resolve, 350))
  const response = await fetch(`https://api.notion.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      'Notion-Version': '2025-09-03',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  })
  // Return only a status/code: upstream error text may contain private content.
  if (!response.ok) throw new Error(`Notion API HTTP ${response.status}，請檢查權限、欄位或稍後重試。`)
  return response.json()
}

export async function syncEvent(env, event) {
  const properties = notionProperties(event, env.NOTION_TIME_ZONE || 'Asia/Taipei')
  const found = await notion(env, `data_sources/${encodeURIComponent(env.NOTION_DATA_SOURCE_ID)}/query`, {
    filter: { property: 'Supabase ID', rich_text: { equals: String(event.id) } }, page_size: 2,
  })
  if (!Array.isArray(found.results)) throw new Error('Notion 查詢格式錯誤。')
  if (found.results.length > 1) throw new Error('Notion 有重複的 Supabase ID，請先清理重複行程。')
  const page = found.results[0]
  const result = page
    ? await notion(env, `pages/${encodeURIComponent(page.id)}`, { properties }, 'PATCH')
    : await notion(env, 'pages', { parent: { data_source_id: env.NOTION_DATA_SOURCE_ID }, properties })
  return result.id
}
