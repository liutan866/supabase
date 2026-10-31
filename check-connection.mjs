const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_PUBLISHABLE_KEY

if (!url || !key) {
  console.error('Missing SUPABASE_URL or Supabase API key in .env')
  process.exit(1)
}

try {
  const response = await fetch(new URL('/rest/v1/', url), {
    headers: { apikey: key, Accept: 'application/openapi+json' },
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) {
    console.error(`Supabase Data API connection failed: HTTP ${response.status}`)
    process.exit(1)
  }
  const schema = await response.json()
  const tables = Object.keys(schema.paths || {}).filter(path => path !== '/' && !path.startsWith('/rpc/'))
  console.log('Supabase Data API connected successfully.')
  console.log(`Available table/view endpoints: ${tables.length}`)
  for (const table of tables) console.log(`  ${table.slice(1)}`)
} catch (error) {
  console.error(`Connection failed: ${error.cause?.code || error.name}`)
  process.exit(1)
}
