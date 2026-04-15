#!/usr/bin/env tsx
/**
 * Local invoke script for the discover-churches edge function.
 *
 * Usage:
 *   npx tsx scripts/scrape.ts --city "Austin" --state "TX" --remote
 *   npx tsx scripts/scrape.ts --county "Wayne" --state "MI" --remote
 *   npx tsx scripts/scrape.ts --county "Wayne" --state "MI" --remote --batch 15
 *
 * Automatically paginates through all churches with websites in batches.
 * OSM-only churches (no website) are saved on the first batch only.
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), 'scripts/.env') })

async function main() {
  const args = process.argv.slice(2)
  const get = (flag: string) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : undefined }

  const city = get('--city')
  const county = get('--county')
  const state = get('--state')
  const batchSize = parseInt(get('--batch') ?? '15')
  const remote = args.includes('--remote')

  if (!city && !county) {
    console.error('Usage: npx tsx scripts/scrape.ts --city "Austin" --state "TX" --remote')
    process.exit(1)
  }

  const url = remote
    ? `${process.env['SUPABASE_URL']}/functions/v1/discover-churches`
    : 'http://localhost:54321/functions/v1/discover-churches'

  const authHeader = remote
    ? `Bearer ${process.env['SUPABASE_SERVICE_ROLE_KEY']}`
    : `Bearer ${process.env['SUPABASE_ANON_KEY'] ?? 'local'}`

  const label = city ? `${city}${state ? `, ${state}` : ''}` : `${county} County${state ? `, ${state}` : ''}`
  console.log(`\nScraping churches in: ${label} (batch size: ${batchSize})\n`)

  let offset = 0
  let totalScraped = 0
  let osmSaved = 0
  let batch = 1

  while (true) {
    console.log(`Batch ${batch} (offset ${offset})...`)

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
      body: JSON.stringify({ city, county, state, limit: batchSize, offset }),
    })

    if (!res.ok) {
      const text = await res.text()
      console.error(`HTTP ${res.status}: ${text}`)
      process.exit(1)
    }

    const data = await res.json()
    if (data.error) { console.error(`Error: ${data.error}`); process.exit(1) }

    // Only shown on first batch
    if (batch === 1) {
      console.log(`  Found ${data.total_found} total churches in OSM`)
      console.log(`  Saved ${data.osm_only} churches from OSM data\n`)
      osmSaved = data.osm_only
    }

    totalScraped += data.scraped ?? 0

    for (const c of data.churches ?? []) {
      const extras = [c.has_photo ? 'photo' : '', c.attendance ? `att:${c.attendance}` : ''].filter(Boolean).join(', ')
      console.log(`  ✓ ${c.name}${c.city ? ` (${c.city})` : ''}${extras ? ` [${extras}]` : ''}`)
    }
    for (const e of data.error_details ?? []) {
      console.log(`  ✗ ${e.name}: ${e.error.slice(0, 80)}`)
    }

    if (data.remaining_with_websites <= 0) break

    offset += batchSize
    batch++
    console.log(`\n  ${data.remaining_with_websites} remaining — fetching next batch...\n`)
    // Small pause between batches to avoid overwhelming the function
    await new Promise(r => setTimeout(r, 2000))
  }

  console.log(`\nDone!`)
  console.log(`  Total scraped+enriched: ${totalScraped}`)
  console.log(`  OSM-only saved:         ${osmSaved}`)
}

main().catch(err => { console.error(err); process.exit(1) })
