import http from 'node:http'
import { readFile } from 'node:fs/promises'

// Only explicitly public assets can be served. Never expose .env.
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/calendar.js', ['calendar.js', 'text/javascript; charset=utf-8']],
])
http.createServer(async (req, res) => {
  const file = files.get(new URL(req.url, 'http://localhost').pathname)
  if (!file || req.method !== 'GET') { res.writeHead(404).end(); return }
  try {
    const body = await readFile(new URL(file[0], import.meta.url))
    res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store' }).end(body)
  } catch { res.writeHead(500).end('Unable to load page') }
}).listen(3000, '127.0.0.1', () => console.log('Local: http://127.0.0.1:3000'))
