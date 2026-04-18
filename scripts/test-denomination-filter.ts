#!/usr/bin/env tsx
/**
 * Denomination filter test suite
 *
 * Tests:
 *   1. Denomination tree structure (levels, parent-child links)
 *   2. findDenomination() lookup for known church names
 *   3. What denomination_id is actually assigned to Trenton churches
 *   4. Filter expansion simulation (what the query returns for each filter combo)
 *
 * Usage:
 *   npx tsx scripts/test-denomination-filter.ts
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), 'scripts/.env') })

const supabase = createClient(
  process.env['SUPABASE_URL']!,
  process.env['SUPABASE_SERVICE_ROLE_KEY']!
)

// ── Helpers (mirrors denomination.service.ts logic) ───────────────────────────

function expandToDescendants(flat: any[], selectedIds: string[]): string[] {
  if (!selectedIds.length) return []
  const all = new Set<string>(selectedIds)
  const addDescendants = (parentId: string) => {
    flat.filter(d => d.parent_id === parentId)
        .forEach(d => { all.add(d.id); addDescendants(d.id) })
  }
  selectedIds.forEach(id => addDescendants(id))
  return Array.from(all)
}

function pruneAncestors(flat: any[], selectedIds: string[]): string[] {
  const selectedSet = new Set(selectedIds)
  const hasSelectedDescendant = (id: string): boolean =>
    flat.filter(d => d.parent_id === id)
        .some(d => selectedSet.has(d.id) || hasSelectedDescendant(d.id))
  return selectedIds.filter(id => !hasSelectedDescendant(id))
}

const DENOM_ALIASES: [RegExp, string][] = [
  [/evangelical/i,          'Non-Denominational'],
  [/church of christ/i,     'Protestant'],
  [/churches of christ/i,   'Protestant'],
  [/independent baptist/i,  'Baptist'],
  [/free will baptist/i,    'Baptist'],
  [/bible church/i,         'Non-Denominational'],
  [/community church/i,     'Non-Denominational'],
  [/christian church/i,     'Non-Denominational'],
  [/interdenominational/i,  'Non-Denominational'],
]

async function findDenomination(name: string | null) {
  if (!name) return { id: null, name: null }
  let lookupName = name
  for (const [pattern, alias] of DENOM_ALIASES) {
    if (pattern.test(name)) { lookupName = alias; break }
  }
  let { data } = await supabase.from('denominations').select('id, name, parent_id').ilike('name', lookupName).limit(1).maybeSingle()
  if (!data && lookupName !== name) {
    ;({ data } = await supabase.from('denominations').select('id, name, parent_id').ilike('name', name).limit(1).maybeSingle() as any)
  }
  if (!data) {
    const word = name.split(/\s+/).find((w: string) => w.length > 4)
    if (word) ({ data } = await supabase.from('denominations').select('id, name, parent_id').ilike('name', `%${word}%`).limit(1).maybeSingle() as any)
  }
  return data ? { id: data.id, name: data.name } : { id: null, name: null }
}

// ── PASS / FAIL helpers ───────────────────────────────────────────────────────

let passed = 0, failed = 0

function expect(label: string, actual: any, expected: any) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
    || (typeof expected === 'string' && String(actual).toLowerCase().includes(expected.toLowerCase()))
  if (ok) {
    console.log(`  ✓ ${label}`)
    passed++
  } else {
    console.log(`  ✗ ${label}`)
    console.log(`      expected: ${JSON.stringify(expected)}`)
    console.log(`      actual:   ${JSON.stringify(actual)}`)
    failed++
  }
}

function expectContains(label: string, haystack: string[], needle: string) {
  const ok = haystack.some(s => s.toLowerCase().includes(needle.toLowerCase()))
  if (ok) { console.log(`  ✓ ${label}`); passed++ }
  else { console.log(`  ✗ ${label} — not found in [${haystack.join(', ')}]`); failed++ }
}

function expectNotContains(label: string, haystack: string[], needle: string) {
  const ok = !haystack.some(s => s.toLowerCase().includes(needle.toLowerCase()))
  if (ok) { console.log(`  ✓ ${label}`); passed++ }
  else { console.log(`  ✗ ${label} — unexpectedly found in [${haystack.join(', ')}]`); failed++ }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

async function main() {

  // ── 1. Denomination tree ──────────────────────────────────────────────────
  console.log('\n═══ 1. Denomination tree structure ═══')
  const { data: allDenoms, error: denomErr } = await supabase
    .from('denominations').select('id, name, level, parent_id').order('level').order('name')
  if (denomErr || !allDenoms) { console.error('Failed to load denominations:', denomErr); process.exit(1) }

  console.log(`\n  Total denominations: ${allDenoms.length}`)
  const byLevel: Record<number, any[]> = {}
  for (const d of allDenoms) {
    if (!byLevel[d.level]) byLevel[d.level] = []
    byLevel[d.level].push(d)
  }
  for (const [level, denoms] of Object.entries(byLevel)) {
    console.log(`  Level ${level}: ${denoms.map((d: any) => d.name).join(', ')}`)
  }

  const find = (name: string) => allDenoms.find((d: any) => d.name.toLowerCase().includes(name.toLowerCase()))
  const protestant = find('protestant')
  const baptist    = find('baptist')
  const methodist  = find('methodist')
  const presbyterian = find('presbyterian')

  console.log('\n  Key denomination IDs:')
  for (const [label, d] of [['Protestant', protestant], ['Baptist', baptist], ['Methodist', methodist], ['Presbyterian', presbyterian]] as [string, any][]) {
    if (d) console.log(`    ${label}: ${d.id} (level ${d.level}, parent: ${d.parent_id ?? 'none'})`)
    else   console.log(`    ${label}: NOT FOUND in DB`)
  }

  expect('Protestant exists in DB',    !!protestant, true)
  expect('Baptist exists in DB',       !!baptist,    true)
  expect('Methodist exists in DB',     !!methodist,  true)
  expect('Presbyterian exists in DB',  !!presbyterian, true)

  if (baptist && protestant) {
    expect('Baptist parent is Protestant', baptist.parent_id, protestant.id)
  }
  if (methodist && protestant) {
    expect('Methodist parent is Protestant', methodist.parent_id, protestant.id)
  }

  // ── 2. findDenomination() lookup tests ───────────────────────────────────
  console.log('\n═══ 2. findDenomination() lookup ═══')

  const cases: [string, string][] = [
    ['Baptist',              'Baptist'],
    ['Southern Baptist',     'Baptist'],
    ['Methodist',            'Methodist'],
    ['United Methodist',     'Methodist'],
    ['Presbyterian',         'Presbyterian'],
    ['Presbyterian Church',  'Presbyterian'],
    ['Lutheran',             'Lutheran'],
    ['Catholic',             'Catholic'],
    ['Non-denominational',   'Non'],
    ['Evangelical',          'Non'],  // aliased → Non-Denominational
  ]

  for (const [input, expectedContains] of cases) {
    const result = await findDenomination(input)
    if (result.name) {
      const ok = result.name.toLowerCase().includes(expectedContains.toLowerCase())
      if (ok) { console.log(`  ✓ findDenomination("${input}") → "${result.name}"`); passed++ }
      else    { console.log(`  ✗ findDenomination("${input}") → "${result.name}" (expected to contain "${expectedContains}")`); failed++ }
    } else {
      console.log(`  ✗ findDenomination("${input}") → null (expected "${expectedContains}")`)
      failed++
    }
  }

  // ── 3. Trenton church denomination assignments ────────────────────────────
  console.log('\n═══ 3. Trenton church denomination_id assignments ═══')

  const { data: trentonChurches } = await supabase
    .from('churches')
    .select('name, denomination_id, denomination_path')
    .ilike('city', '%trenton%')
    .order('name')

  if (!trentonChurches?.length) {
    console.log('  No Trenton churches found')
  } else {
    const denomMap = new Map(allDenoms.map((d: any) => [d.id, d.name]))
    let nullCount = 0
    for (const c of trentonChurches) {
      const denomName = c.denomination_id ? denomMap.get(c.denomination_id) ?? '?? unknown ID' : 'NULL'
      const pathStr   = c.denomination_path?.join(' › ') ?? '—'
      const mismatch  = c.denomination_id && denomName !== '?? unknown ID' &&
                        c.denomination_path?.length &&
                        !c.denomination_path[c.denomination_path.length - 1].toLowerCase()
                          .includes(denomName.toLowerCase()) ? ' ⚠️  PATH/ID MISMATCH' : ''
      if (!c.denomination_id) nullCount++
      console.log(`  ${c.denomination_id ? '✓' : '✗'} ${c.name}`)
      console.log(`      denomination_id → ${denomName}${mismatch}`)
      console.log(`      denomination_path → ${pathStr}`)
    }
    console.log(`\n  Churches with NULL denomination_id: ${nullCount}/${trentonChurches.length}`)
    expect('Majority of Trenton churches have denomination_id set',
      nullCount < trentonChurches.length / 2, true)
  }

  // ── 4. Filter expansion simulation ───────────────────────────────────────
  console.log('\n═══ 4. Filter expansion simulation ═══')

  if (baptist && methodist && presbyterian && protestant) {
    const baptistId     = baptist.id
    const methodistId   = methodist.id
    const presbyterianId = presbyterian.id
    const protestantId  = protestant.id

    // Simulate: select "Baptist" only
    {
      const pruned   = pruneAncestors(allDenoms, [baptistId])
      const expanded = expandToDescendants(allDenoms, pruned)
      const expandedNames = expanded.map(id => allDenoms.find((d: any) => d.id === id)?.name ?? id)
      console.log(`\n  Filter: [Baptist]`)
      console.log(`    expanded: ${expandedNames.join(', ')}`)
      expectNotContains('Baptist filter does NOT include Methodist',    expandedNames, 'methodist')
      expectNotContains('Baptist filter does NOT include Presbyterian', expandedNames, 'presbyterian')

      // Run actual DB query
      const { data: results } = await supabase.from('churches').select('name, denomination_id')
        .ilike('city', '%trenton%').in('denomination_id', expanded)
      const denomMap = new Map(allDenoms.map((d: any) => [d.id, d.name]))
      console.log(`    DB results (${results?.length ?? 0}): ${results?.map(c => `${c.name} [${denomMap.get(c.denomination_id) ?? 'null'}]`).join(', ') || 'none'}`)
    }

    // Simulate: select "Protestant" + "Baptist"
    {
      const pruned   = pruneAncestors(allDenoms, [protestantId, baptistId])
      const expanded = expandToDescendants(allDenoms, pruned)
      const expandedNames = expanded.map(id => allDenoms.find((d: any) => d.id === id)?.name ?? id)
      console.log(`\n  Filter: [Protestant, Baptist] (after pruneAncestors)`)
      console.log(`    pruned to: ${pruned.map(id => allDenoms.find((d: any) => d.id === id)?.name).join(', ')}`)
      console.log(`    expanded: ${expandedNames.join(', ')}`)
      expectNotContains('Protestant+Baptist filter does NOT include Methodist',    expandedNames, 'methodist')
      expectNotContains('Protestant+Baptist filter does NOT include Presbyterian', expandedNames, 'presbyterian')
    }

    // Simulate: select "Protestant" only
    {
      const pruned   = pruneAncestors(allDenoms, [protestantId])
      const expanded = expandToDescendants(allDenoms, pruned)
      const expandedNames = expanded.map(id => allDenoms.find((d: any) => d.id === id)?.name ?? id)
      console.log(`\n  Filter: [Protestant]`)
      console.log(`    expanded: ${expandedNames.join(', ')}`)
      expectContains('Protestant filter DOES include Methodist',    expandedNames, 'methodist')
      expectContains('Protestant filter DOES include Presbyterian', expandedNames, 'presbyterian')
      expectContains('Protestant filter DOES include Baptist',      expandedNames, 'baptist')
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(50)}`)
  console.log(`Results: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main().catch(err => { console.error(err); process.exit(1) })
