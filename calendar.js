const CALENDAR_API_URL = 'https://restless-cherry-3164.dennis866.workers.dev/api/calendar-events'
const $ = id => document.getElementById(id)

function message(text, error = false) {
  $('status').textContent = text
  $('status').classList.toggle('error', error)
}

async function createEvent(body) {
  const response = await fetch(CALENDAR_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  })
  const text = await response.text()
  let data
  try { data = JSON.parse(text) } catch {
    throw new Error(`行程 API 回傳無效的 JSON（HTTP ${response.status}）。請檢查 Worker 部署與設定。`)
  }
  if (!response.ok) {
    if (data?.code === 'PGRST205' || data?.code === '42P01') {
      throw new Error('找不到 calendar_events 資料表，請先在 Supabase SQL Editor 執行建表 SQL。')
    }
    if (data?.code === '42501' || data?.code === '23502') {
      throw new Error('資料庫尚未允許匿名新增。請在 SQL Editor 執行 enable-anonymous-insert.sql。')
    }
    const reason = data?.error || data?.msg || data?.error_description || data?.message || `HTTP ${response.status}`
    throw new Error(data?.details ? `${reason}：${data.details}` : reason)
  }
  return data
}

async function loadEvents() {
  const button = $('refresh-events')
  button.disabled = true
  $('events-status').classList.remove('error')
  $('events-status').textContent = '正在載入行程…'
  try {
    const response = await fetch(CALENDAR_API_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    })
    const text = await response.text()
    let data
    try { data = JSON.parse(text) } catch {
      throw new Error(`行程 API 回傳無效的 JSON（HTTP ${response.status}）。請檢查 Worker 部署與設定。`)
    }
    if (!response.ok) {
      const reason = data?.error || data?.message || `HTTP ${response.status}`
      throw new Error(data?.details ? `${reason}：${data.details}` : reason)
    }
    if (!Array.isArray(data?.events)) throw new Error('行程 API 回傳格式錯誤。')

    const list = $('events-list')
    list.replaceChildren()
    if (data.events.length === 0) {
      const empty = document.createElement('li')
      empty.className = 'empty'
      empty.textContent = '目前沒有行程。'
      list.append(empty)
    } else {
      for (const event of data.events) {
        const item = document.createElement('li')
        item.className = 'event-item'
        const title = document.createElement('h3')
        title.textContent = event.title
        const time = document.createElement('p')
        time.className = 'event-time'
        const start = new Date(event.starts_at)
        const end = new Date(event.ends_at)
        const dateOptions = { year: 'numeric', month: 'long', day: 'numeric' }
        const timeOptions = { ...dateOptions, hour: '2-digit', minute: '2-digit' }
        if (event.all_day) {
          end.setDate(end.getDate() - 1)
          const startText = start.toLocaleDateString('zh-Hant', dateOptions)
          const endText = end.toLocaleDateString('zh-Hant', dateOptions)
          time.textContent = `${startText}${startText === endText ? '' : ` – ${endText}`}（全天）`
        } else {
          time.textContent = `${start.toLocaleString('zh-Hant', timeOptions)} – ${end.toLocaleString('zh-Hant', timeOptions)}`
        }
        item.append(title, time)
        if (event.location) {
          const location = document.createElement('p')
          location.textContent = `地點：${event.location}`
          item.append(location)
        }
        if (event.description) {
          const description = document.createElement('p')
          description.textContent = event.description
          item.append(description)
        }
        list.append(item)
      }
    }
    $('events-status').textContent = `共 ${data.events.length} 筆行程`
  } catch (error) {
    $('events-status').textContent = `讀取行程失敗：${error.message}`
    $('events-status').classList.add('error')
  } finally {
    button.disabled = false
  }
}

$('timezone').textContent = `時間依此裝置時區：${Intl.DateTimeFormat().resolvedOptions().timeZone}`
$('refresh-events').addEventListener('click', loadEvents)
document.addEventListener('DOMContentLoaded', loadEvents)
$('all-day').addEventListener('change', () => {
  for (const id of ['start', 'end']) {
    const value = $(id).value
    $(id).type = $('all-day').checked ? 'date' : 'datetime-local'
    $(id).value = value ? ($('all-day').checked ? value.slice(0, 10) : `${value.slice(0, 10)}T09:00`) : ''
  }
})

$('event-form').addEventListener('submit', async event => {
  event.preventDefault()
  const title = $('title').value.trim()
  const allDay = $('all-day').checked
  const start = new Date($('start').value + (allDay ? 'T00:00:00' : ''))
  const end = new Date($('end').value + (allDay ? 'T00:00:00' : ''))
  if (!title) return message('請填寫行程名稱。', true)
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || end <= start) {
    return message('結束時間必須晚於開始時間。', true)
  }
  $('event-fields').disabled = true
  message('正在新增行程…')
  try {
    await createEvent({
      title,
      starts_at: start.toISOString(), ends_at: end.toISOString(),
      all_day: allDay, location: $('location').value.trim() || null,
      description: $('description').value.trim() || null,
    })
    $('event-form').reset()
    $('start').type = $('end').type = 'datetime-local'
    message(`已新增「${title}」`)
    await loadEvents()
  } catch (error) {
    message(`新增失敗：${error.message}`, true)
  } finally { $('event-fields').disabled = false }
})
