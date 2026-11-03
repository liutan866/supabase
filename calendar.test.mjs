import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('./calendar.js', import.meta.url), 'utf8')

function setup(fetch) {
  const elements = new Map()
  const createElement = id => ({
      value: '', checked: false, disabled: false, type: 'datetime-local',
      textContent: '', className: '', listeners: {}, error: false, children: [],
      classList: {
        toggle(name, value) { elements.get(id)[name] = value },
        remove(name) { if (elements.has(id)) elements.get(id)[name] = false },
        add(name) { if (elements.has(id)) elements.get(id)[name] = true },
      },
      addEventListener(name, callback) { this.listeners[name] = callback },
      append(...children) { this.children.push(...children) },
      replaceChildren(...children) { this.children = children },
      reset() { this.wasReset = true },
    })
  for (const id of ['calendar-month', 'calendar-grid', 'previous-month', 'next-month', 'today-month', 'status', 'timezone', 'all-day', 'start', 'end', 'event-form', 'title', 'event-fields', 'location', 'description', 'refresh-events', 'events-status', 'events-list']) {
    elements.set(id, createElement(id))
  }
  const documentListeners = {}
  vm.runInNewContext(source, {
    document: {
      getElementById: id => elements.get(id),
      createElement: () => createElement(null),
      addEventListener(name, callback) { documentListeners[name] = callback },
    },
    fetch, AbortSignal, Intl,
  })
  const get = id => elements.get(id)
  get('title').value = ' Meeting '
  get('start').value = '2026-11-01T09:00'
  get('end').value = '2026-11-01T10:00'
  return {
    get,
    load: () => documentListeners.DOMContentLoaded(),
    submit: () => get('event-form').listeners.submit({ preventDefault() {} }),
  }
}

test('homepage loads the shared calendar script, not a duplicate implementation', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8')
  assert.match(html, /<script src="calendar\.js"><\/script>/)
  assert.equal((html.match(/<script\b/g) || []).length, 1)
  assert.doesNotMatch(html + source, /sb_publishable_|apikey|supabase\.co/)
})

test('teaching pages load their own scripts and endpoints', async () => {
  const html2 = await readFile(new URL('./index-2.html', import.meta.url), 'utf8')
  const html3 = await readFile(new URL('./index-3.html', import.meta.url), 'utf8')
  const js2 = await readFile(new URL('./calendar-2.js', import.meta.url), 'utf8')
  const js3 = await readFile(new URL('./calendar-3.js', import.meta.url), 'utf8')
  assert.match(html2, /<script src="calendar-2\.js"><\/script>/)
  assert.match(html3, /<script src="calendar-3\.js"><\/script>/)
  assert.match(js2, /\/api\/calendar-events-2/)
  assert.match(js3, /\/api\/calendar-events-3/)
  assert.match(js2, /calendar_events_2/)
  assert.match(js3, /calendar_events_3/)
})

test('submits JSON to Worker and resets only after success', async () => {
  let called = false
  const ui = setup(async (url, options) => {
    if (options.method === undefined) return Response.json({ events: [] })
    called = true
    assert.equal(url, 'https://restless-cherry-3164.dennis866.workers.dev/api/calendar-events')
    assert.equal(options.method, 'POST')
    assert.deepEqual({ ...options.headers }, { 'Content-Type': 'application/json' })
    assert.deepEqual(JSON.parse(options.body), {
      title: 'Meeting',
      starts_at: new Date('2026-11-01T09:00').toISOString(),
      ends_at: new Date('2026-11-01T10:00').toISOString(),
      all_day: false, location: null, description: null,
    })
    assert.equal(ui.get('event-fields').disabled, true)
    return Response.json({ message: 'Created' }, { status: 201 })
  })
  await ui.submit()
  assert.equal(called, true)
  assert.equal(ui.get('event-form').wasReset, true)
  assert.equal(ui.get('event-fields').disabled, false)
  assert.equal(ui.get('status').error, false)
  assert.match(ui.get('status').textContent, /Meeting/)
})

test('preserves all-day dates and optional fields', async () => {
  let body
  const ui = setup(async (url, options) => {
    if (options.method === undefined) return Response.json({ events: [] })
    body = JSON.parse(options.body)
    return Response.json({ message: 'Created' }, { status: 201 })
  })
  ui.get('all-day').checked = true
  ui.get('all-day').listeners.change()
  assert.equal(ui.get('start').type, 'date')
  ui.get('end').value = '2026-11-02'
  ui.get('location').value = ' Office '
  ui.get('description').value = ' Notes '
  await ui.submit()
  assert.equal(body.all_day, true)
  assert.equal(body.starts_at, new Date('2026-11-01T00:00:00').toISOString())
  assert.equal(body.ends_at, new Date('2026-11-02T00:00:00').toISOString())
  assert.equal(body.location, 'Office')
  assert.equal(body.description, 'Notes')
  assert.equal(ui.get('start').type, 'datetime-local')
})

test('rejects invalid input without sending a request', async () => {
  for (const [field, value] of [['title', ' '], ['end', '2026-11-01T09:00'], ['start', 'invalid']]) {
    const ui = setup(() => assert.fail('Invalid input must not reach the API'))
    ui.get(field).value = value
    await ui.submit()
    assert.equal(ui.get('status').error, true)
    assert.equal(ui.get('event-fields').disabled, false)
    assert.equal(ui.get('event-form').wasReset, undefined)
  }
})

test('shows Worker errors, malformed responses, and network failures without clearing input', async () => {
  const cases = [
    [() => Response.json({ error: 'Supabase insert failed', details: 'RLS denied' }, { status: 502 }), /Supabase insert failed.*RLS denied/],
    [() => new Response('Worker exception', { status: 500 }), /JSON.*500/],
    [() => { throw new Error('Failed to fetch') }, /Failed to fetch/],
  ]
  for (const [fetch, expected] of cases) {
    const ui = setup(fetch)
    await ui.submit()
    assert.equal(ui.get('status').error, true)
    assert.match(ui.get('status').textContent, expected)
    assert.equal(ui.get('event-fields').disabled, false)
    assert.equal(ui.get('event-form').wasReset, undefined)
    assert.equal(ui.get('title').value, ' Meeting ')
  }
})

test('loads and safely renders every event from the read API', async () => {
  const ui = setup(async (url, options) => {
    assert.equal(options.method, undefined)
    return Response.json({
      events: [{
        title: '<script>not markup</script>',
        starts_at: '2026-11-01T09:00:00.000Z',
        ends_at: '2026-11-01T10:00:00.000Z',
        all_day: false, location: 'Room 1', description: 'Bring notes',
      }],
    })
  })
  await ui.load()
  assert.equal(ui.get('events-list').children.length, 1)
  const [item] = ui.get('events-list').children
  assert.equal(item.children[0].textContent, '<script>not markup</script>')
  assert.equal(item.children[1].className, 'event-time')
  assert.equal(item.children[2].textContent, '地點：Room 1')
  assert.equal(item.children[3].textContent, 'Bring notes')
  assert.match(ui.get('events-status').textContent, /共 1 筆/)
  assert.equal(ui.get('refresh-events').disabled, false)
})

test('shows an explicit error when the read API fails', async () => {
  const ui = setup(async () => Response.json({ error: 'Supabase unavailable' }, { status: 502 }))
  await ui.load()
  assert.match(ui.get('events-status').textContent, /Supabase unavailable/)
  assert.equal(ui.get('events-status').error, true)
  assert.equal(ui.get('refresh-events').disabled, false)
})

test('month calendar shows spanning events with an exclusive end and supports navigation', async () => {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 10)
  const end = new Date(now.getFullYear(), now.getMonth(), 12)
  const ui = setup(async () => Response.json({ events: [{
    title: '跨日活動', starts_at: start.toISOString(), ends_at: end.toISOString(), all_day: true,
  }] }))
  await ui.load()
  const cells = ui.get('calendar-grid').children.slice(7)
  const entries = cells.flatMap(cell => cell.children.slice(1))
  assert.equal(entries.length, 2)
  assert.equal(entries[0].textContent, '全天 跨日活動')
  const label = ui.get('calendar-month').textContent
  ui.get('next-month').listeners.click()
  assert.notEqual(ui.get('calendar-month').textContent, label)
  ui.get('previous-month').listeners.click()
  assert.equal(ui.get('calendar-month').textContent, label)
  ui.get('next-month').listeners.click()
  ui.get('today-month').listeners.click()
  assert.equal(ui.get('calendar-month').textContent, label)
})
