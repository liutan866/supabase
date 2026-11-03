import assert from 'node:assert/strict'
import test from 'node:test'
import worker from './worker.js'

const env = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SECRET_KEY: 'test-secret' }

test('GET sorts all pages by start time proximity to now, with invalid dates last', async t => {
  const now = Date.parse('2026-11-01T12:00:00Z')
  t.mock.method(Date, 'now', () => now)
  let page = 0
  t.mock.method(globalThis, 'fetch', async () => Response.json(page++ === 0
    ? [
        { title: 'far future', starts_at: '2026-12-01T12:00:00Z' },
        { title: 'far past', starts_at: '2026-10-01T12:00:00Z' },
        ...Array.from({ length: 998 }, () => ({ title: 'invalid' })),
      ]
    : [
        { title: 'near future', starts_at: '2026-11-01T13:00:00Z' },
        { title: 'near past', starts_at: '2026-11-01T11:30:00Z' },
      ]))
  const response = await worker.fetch(new Request('https://worker.example/api/calendar-events'), env)
  const { events } = await response.json()
  assert.deepEqual(events.slice(0, 4).map(event => event.title), ['near past', 'near future', 'far future', 'far past'])
  assert.equal(events.at(-1).title, 'invalid')
})

test('GET reads all calendar rows in ordered pages', async t => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const ranges = []
  globalThis.fetch = async (url, options) => {
    ranges.push(options.headers.Range)
    assert.equal(options.headers.apikey, 'test-secret')
    assert.equal(options.headers.Authorization, undefined)
    assert.equal(new URL(url).searchParams.get('order'), 'starts_at.asc')
    const records = ranges.length === 1
      ? Array.from({ length: 1000 }, (_, index) => ({ title: `Event ${index}` }))
      : [{ title: 'Last event' }]
    return Response.json(records)
  }

  const response = await worker.fetch(new Request('https://worker.example/api/calendar-events'), env)
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.deepEqual(ranges, ['0-999', '1000-1999'])
  assert.equal(body.events.length, 1001)
  assert.equal(body.events.at(-1).title, 'Last event')
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*')
})

test('teaching APIs map to their own Supabase tables', async t => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ method: options.method || 'GET', path: new URL(url).pathname })
    return options.method === 'POST'
      ? new Response(null, { status: 201 })
      : Response.json([])
  }

  await worker.fetch(new Request('https://worker.example/api/calendar-events-2'), env)
  await worker.fetch(new Request('https://worker.example/api/calendar-events-3'), env)
  await worker.fetch(new Request('https://worker.example/api/calendar-events-2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Meeting',
      starts_at: '2026-11-01T09:00:00Z',
      ends_at: '2026-11-01T10:00:00Z',
      all_day: false,
    }),
  }), env)

  assert.deepEqual(calls.map(call => call.path), [
    '/rest/v1/calendar_events_2',
    '/rest/v1/calendar_events_3',
    '/rest/v1/calendar_events_2',
  ])
})

test('POST preserves the existing create API and does not return the secret', async t => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  let inserted
  globalThis.fetch = async (url, options) => {
    assert.equal(options.method, 'POST')
    inserted = JSON.parse(options.body)
    assert.equal(options.headers.apikey, 'test-secret')
    return new Response(null, { status: 201 })
  }
  const request = new Request('https://worker.example/api/calendar-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: ' Meeting ',
      starts_at: '2026-11-01T09:00:00.000Z',
      ends_at: '2026-11-01T10:00:00.000Z',
      all_day: false,
      location: ' Office ',
      description: ' Notes ',
    }),
  })
  const response = await worker.fetch(request, env)
  assert.equal(response.status, 201)
  assert.deepEqual(inserted, {
    title: 'Meeting',
    starts_at: '2026-11-01T09:00:00.000Z',
    ends_at: '2026-11-01T10:00:00.000Z',
    all_day: false,
    location: 'Office',
    description: 'Notes',
  })
  assert.deepEqual(await response.json(), { message: 'Created' })
})

test('rejects invalid input and unsupported routes without contacting Supabase', async () => {
  const request = new Request('https://worker.example/api/calendar-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Invalid', starts_at: '2026-11-02', ends_at: '2026-11-01', all_day: false }),
  })
  const response = await worker.fetch(request, env)
  assert.equal(response.status, 400)
  assert.match((await response.json()).error, /結束時間/)

  const nullBody = await worker.fetch(new Request('https://worker.example/api/calendar-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'null',
  }), env)
  assert.equal(nullBody.status, 400)

  const notFound = await worker.fetch(new Request('https://worker.example/unknown'), env)
  assert.equal(notFound.status, 404)
})

test('handles preflight and missing Worker secrets explicitly', async () => {
  const preflight = await worker.fetch(new Request('https://worker.example/api/calendar-events', { method: 'OPTIONS' }), env)
  assert.equal(preflight.status, 204)
  assert.match(preflight.headers.get('Access-Control-Allow-Methods'), /GET/)

  const missingConfig = await worker.fetch(new Request('https://worker.example/api/calendar-events'), {})
  assert.equal(missingConfig.status, 500)
  assert.match((await missingConfig.json()).error, /尚未設定/)
})

test('uses the existing anonymous key for GET and POST without a secret key', async t => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const anonymousEnv = {
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_ANON_KEY: 'sb_publishable_test',
  }
  const methods = []
  globalThis.fetch = async (url, options) => {
    assert.equal(options.headers.apikey, anonymousEnv.SUPABASE_ANON_KEY)
    assert.equal(options.headers.Authorization, undefined)
    methods.push(options.method || 'GET')
    return options.method === 'POST'
      ? new Response(null, { status: 201 })
      : Response.json([])
  }
  const read = await worker.fetch(new Request('https://worker.example/api/calendar-events'), anonymousEnv)
  assert.equal(read.status, 200)
  assert.deepEqual(await read.json(), { events: [] })

  const create = await worker.fetch(new Request('https://worker.example/api/calendar-events', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Meeting',
      starts_at: '2026-11-01T09:00:00Z',
      ends_at: '2026-11-01T10:00:00Z',
      all_day: false,
    }),
  }), anonymousEnv)
  assert.equal(create.status, 201)
  assert.deepEqual(methods, ['GET', 'POST'])
})
