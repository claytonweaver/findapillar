#!/usr/bin/env tsx
/**
 * Local invoke script for the discover-churches edge function.
 *
 * Usage:
 *   npx tsx scripts/scrape.ts --city "Austin" --state "TX"
 *   npx tsx scripts/scrape.ts --county "Travis" --state "TX"
 *   npx tsx scripts/scrape.ts --city "Denver" --state "CO" --remote
 *
 * By default, targets local Supabase (http://localhost:54321).
 * Pass --remote to target the deployed function instead.
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), 'scripts/.env') })

async function main() {
  const args = process.argv.slice(2)
  const get = (flag: string) => {
    const i = args.indexOf(flag)
    return i !== -1 ? args[i + 1] : undefined
  }

  const city = get('--city')
  const county = get('--county')
  const state = get('--state')
  const limit = get('--limit') ? parseInt(get('--limit')!) : 10
  const remote = args.includes('--remote')

  if (!city && !county) {
    console.error('Error: pass --city "Name" or --county "Name"')
    console.error('Example: npx tsx scripts/scrape.ts --city "Austin" --state "TX"')
    process.exit(1)
  }

  const LOCAL_URL = 'http://localhost:54321/functions/v1/discover-churches'
  const REMOTE_URL = `${process.env['SUPABASE_URL']}/functions/v1/discover-churches`
  const url = remote ? REMOTE_URL : LOCAL_URL

  if (remote && !process.env['SUPABASE_URL']) {
    console.error('Error: SUPABASE_URL not set in scripts/.env')
    process.exit(1)
  }

  const authHeader = remote
    ? `Bearer ${process.env['SUPABASE_SERVICE_ROLE_KEY']}`
    : `Bearer ${process.env['SUPABASE_ANON_KEY'] ?? 'local'}`

  const label = city ? `${city}${state ? `, ${state}` : ''}` : `${county} County${state ? `, ${state}` : ''}`
  console.log(`\nScraping churches in: ${label}`)
  console.log(`Target: ${remote ? 'remote (deployed)' : 'local (supabase functions serve)'}`)
  console.log(`URL: ${url}\n`)

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authHeader,
    },
    body: JSON.stringify({ city, county, state, limit }),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error(`HTTP ${res.status}: ${text}`)
    process.exit(1)
  }

  const data = await res.json()

  if (data.error) {
    console.error(`Function error: ${data.error}`)
    process.exit(1)
  }

  console.log(`✓ Found ${data.total_found} places via OpenStreetMap (${data.with_websites} have websites)`)
  console.log(`✓ Processed ${data.processed} churches into Supabase`)
  if (data.skipped) console.log(`  Skipped ${data.skipped} (scrape/process errors)`)
  if (data.remaining > 0) console.log(`  ${data.remaining} more with websites — re-run with --limit to continue\n`)
  else console.log()

  if (data.churches?.length) {
    console.log('Churches processed:')
    for (const c of data.churches) {
      console.log(`  • ${c.name}${c.city ? ` (${c.city})` : ''} — id: ${c.id}`)
    }
  }

  if (data.skipped_details?.length) {
    console.log(`\nSkipped (${data.skipped_details.length}):`)
    for (const s of data.skipped_details) {
      console.log(`  - ${s.name}: ${s.reason}`)
    }
  }
}

main().catch(err => { console.error(err); process.exit(1) })
