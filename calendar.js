const CALENDAR_API_URL = 'https://restless-cherry-3164.dennis866.workers.dev/api/calendar-events'
const $ = id => document.getElementById(id)
let calendarEvents = []
let calendarMonth = new Date()
calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1)

function renderCalendar() {
  $('calendar-month').textContent = calendarMonth.toLocaleDateString('zh-Hant', { year: 'numeric', month: 'long' })
  const grid = $('calendar-grid')
  grid.replaceChildren()
  for (const name of ['日', '一', '二', '三', '四', '五', '六']) {
    const heading = document.createElement('div')
    heading.className = 'weekday'
    heading.textContent = name
    grid.append(heading)
  }
  const first = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1 - calendarMonth.getDay())
  const today = new Date()
  const days = Math.ceil((calendarMonth.getDay() + new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate()) / 7) * 7
  for (let index = 0; index < days; index++) {
    const date = new Date(first.getFullYear(), first.getMonth(), first.getDate() + index)
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
    const cell = document.createElement('div')
    cell.className = `calendar-day${date.getMonth() !== calendarMonth.getMonth() ? ' outside' : ''}${date.toDateString() === today.toDateString() ? ' today' : ''}`
    const number = document.createElement('span')
    number.className = 'day-number'
    number.textContent = String(date.getDate())
    cell.append(number)
    calendarEvents.forEach((event, eventIndex) => {
      const start = new Date(event.starts_at)
      const end = new Date(event.ends_at)
      if (start >= next || end <= date || !Number.isFinite(+start) || !Number.isFinite(+end)) return
      const entry = document.createElement('button')
      entry.type = 'button'
      entry.className = 'calendar-event'
      const time = event.all_day ? '全天' : start < date ? '續' : start.toLocaleTimeString('zh-Hant', { hour: '2-digit', minute: '2-digit', hour12: false })
      entry.textContent = `${time} ${event.title}`
      entry.title = `${event.title}${event.location ? `｜${event.location}` : ''}`
      entry.addEventListener('click', () => {
        const item = $('events-list').children[eventIndex]
        item.scrollIntoView({ behavior: 'smooth', block: 'center' })
        item.focus({ preventScroll: true })
      })
      cell.append(entry)
    })
    grid.append(cell)
  }
}

for (const [id, offset] of [['previous-month', -1], ['next-month', 1], ['today-month', 0]]) {
  $(id).addEventListener('click', () => {
    const base = offset === 0 ? new Date() : calendarMonth
    calendarMonth = new Date(base.getFullYear(), base.getMonth() + offset, 1)
    renderCalendar()
  })
}
renderCalendar()

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
    calendarEvents = [...data.events]

    const list = $('events-list')
    list.replaceChildren()
    if (data.events.length === 0) {
      const empty = document.createElement('li')
      empty.className = 'empty'
      empty.textContent = '目前沒有行程。'
      list.append(empty)
    } else {
      for (const event of calendarEvents) {
        const item = document.createElement('li')
        item.className = 'event-item'
        item.tabIndex = -1
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
    renderCalendar()
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
