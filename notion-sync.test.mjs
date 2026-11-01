import test from 'node:test'
import assert from 'node:assert/strict'
import { notionProperties } from './notion-sync.js'
import worker from './worker.js'

const event = { id: 'event-1', title: '會議', starts_at: '2026-10-31T16:00:00Z', ends_at: '2026-11-01T16:00:00Z', all_day: true }
const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon', NOTION_TOKEN: 'private', NOTION_DATA_SOURCE_ID: 'source', NOTION_SYNC_SECRET: 'webhook-secret' }
const request = (path, body, secret = env.NOTION_SYNC_SECRET) => new Request(`https://worker.example/api/notion/${path}`, {
  method: 'POST', headers: { Authorization: `Bearer ${secret}` }, body: JSON.stringify(body),
})

test('converts exclusive all-day end in Taipei and clears empty optional fields', () => {
  const properties = notionProperties(event)
  assert.deepEqual(properties['行程時間'].date, { start: '2026-11-01', end: '2026-11-01' })
  assert.deepEqual(properties['地點'], { rich_text: [] })
  assert.equal(notionProperties({ ...event, all_day: false })['行程時間'].date.start, '2026-10-31T16:00:00.000Z')
})

test('rejects unauthorized requests and invalid webhook payloads before any upstream call', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('must not call upstream'))
  assert.equal((await worker.fetch(request('webhook', {}, 'wrong'), env)).status, 401)
  assert.equal((await worker.fetch(request('webhook', { type: 'DELETE' }), env)).status, 400)
  assert.equal((await worker.fetch(request('backfill', { after: 'bad,cursor' }), env)).status, 400)
})

test('webhook re-reads current Supabase data, creates once and updates on repeat', async t => {
  let exists = false
  const writes = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const address = String(url)
    if (address.startsWith(env.SUPABASE_URL)) {
      assert.equal(new URL(url).searchParams.get('id'), 'eq.event-1')
      return Response.json([event])
    }
    assert.equal(options.headers.Authorization, 'Bearer private')
    if (address.endsWith('/query')) return Response.json({ results: exists ? [{ id: 'notion-page' }] : [] })
    writes.push({ address, method: options.method, body: JSON.parse(options.body) })
    exists = true
    return Response.json({ id: 'notion-page' })
  })
  const payload = { schema: 'public', table: 'calendar_events', type: 'UPDATE', record: { id: event.id, title: 'stale' } }
  for (let index = 0; index < 2; index++) assert.equal((await worker.fetch(request('webhook', payload), env)).status, 200)
  assert.deepEqual(writes.map(write => write.method), ['POST', 'PATCH'])
  assert.equal(writes[0].body.properties['行程名稱'].title[0].text.content, '會議')
})

test('backfill supplies a continuation cursor and reports partial failures for retry', async t => {
  let fail = false
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).startsWith(env.SUPABASE_URL)) {
      assert.equal(new URL(url).searchParams.get('limit'), '5')
      return Response.json(Array.from({ length: 5 }, (_, i) => ({ ...event, id: `event-${i}` })))
    }
    if (fail) return Response.json({}, { status: 429 })
    return Response.json(String(url).endsWith('/query') ? { results: [] } : { id: 'page' })
  })
  const response = await worker.fetch(request('backfill', {}), env)
  assert.deepEqual(await response.json(), { synced: 5, next: 'event-4' })
  fail = true
  const failure = await worker.fetch(request('backfill', {}), env)
  assert.equal(failure.status, 502)
  assert.equal((await failure.json()).failedId, 'event-0')
})
