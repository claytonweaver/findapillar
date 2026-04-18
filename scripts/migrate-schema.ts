#!/usr/bin/env tsx
/**
 * Drops and recreates all church-related tables with the enriched schema.
 *
 * Requires SUPABASE_ACCESS_TOKEN in scripts/.env
 * (get yours at: https://supabase.com/dashboard/account/tokens)
 *
 * Usage:
 *   npx tsx scripts/migrate-schema.ts
 *
 * If you don't have a personal access token, paste the SQL from
 * supabase/migrations/20260417_enriched_schema.sql directly into the
 * Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql/new
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { config } from 'dotenv'

config({ path: resolve(process.cwd(), 'scripts/.env') })

const ACCESS_TOKEN = process.env['SUPABASE_ACCESS_TOKEN']
const SUPABASE_URL = process.env['SUPABASE_URL'] ?? ''

// Extract project ref from URL (e.g. https://abcdef.supabase.co → abcdef)
const PROJECT_REF = SUPABASE_URL.replace('https://', '').split('.')[0]

const sqlPath = resolve(process.cwd(), 'supabase/migrations/20260417_enriched_schema.sql')
const sql = readFileSync(sqlPath, 'utf-8')

async function runViaMgmtApi(): Promise<void> {
  const url = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Management API ${res.status}: ${body}`)
  }
  console.log('✓ Migration applied successfully via Supabase Management API')
}

async function main() {
  if (!ACCESS_TOKEN) {
    console.log('─'.repeat(60))
    console.log('No SUPABASE_ACCESS_TOKEN found in scripts/.env')
    console.log('To run the migration automatically, add your personal access')
    console.log('token (https://supabase.com/dashboard/account/tokens) and re-run.')
    console.log()
    console.log('Alternatively, copy and paste the following SQL into the')
    console.log('Supabase SQL Editor:')
    console.log('  https://supabase.com/dashboard/project/_/sql/new')
    console.log('─'.repeat(60))
    console.log()
    console.log(sql)
    process.exit(0)
  }

  if (!PROJECT_REF) {
    console.error('Could not determine project ref from SUPABASE_URL')
    process.exit(1)
  }

  console.log(`Applying migration to project: ${PROJECT_REF}`)
  console.log('⚠️  This will DROP all existing church data. Continue? (Ctrl+C to abort)')
  await new Promise(r => setTimeout(r, 3000))

  await runViaMgmtApi()
}

main().catch(err => { console.error('Error:', err.message); process.exit(1) })
