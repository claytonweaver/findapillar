#!/usr/bin/env tsx
/**
 * Standalone church scraper — runs entirely locally.
 * No edge function needed — unlimited compute.
 *
 * Usage:
 *   npx tsx scripts/scrape.ts --city "Austin" --state "TX"
 *   npx tsx scripts/scrape.ts --county "Wayne" --state "MI"
 *   npx tsx scripts/scrape.ts --county "Wayne" --state "MI" --force   # re-enrich already enriched
 */

import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), 'scripts/.env') })

const SUPABASE_URL = process.env['SUPABASE_URL']!
const SUPABASE_SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY']!
const ANTHROPIC_API_KEY = process.env['ANTHROPIC_API_KEY']!

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !ANTHROPIC_API_KEY) {
  console.error('Missing env vars. Check scripts/.env')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

const VALID_TAGS = [
  'lgbt-affirming', 'women-pastors', 'missions-focused', 'social-justice',
  'charismatic', 'reformed', 'evangelical', 'progressive', 'conservative',
  'multi-ethnic', 'young-adults', 'families', 'seniors', 'recovery-ministry',
  'spanish-service', 'korean-service', 'chinese-service', 'deaf-ministry',
  'prison-ministry', 'food-pantry', 'counseling',
]

// ── OSM ───────────────────────────────────────────────────────────────────────

async function getOsmAreaId(location: string): Promise<number> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1`,
    { headers: { 'User-Agent': 'FindAPillar/1.0' } }
  )
  const data = await res.json() as any[]
  if (!data?.length) throw new Error(`No geocoding results for: ${location}`)
  const hit = data[0]
  if (hit.osm_type === 'relation') return 3_600_000_000 + parseInt(hit.osm_id)
  if (hit.osm_type === 'way') return 2_400_000_000 + parseInt(hit.osm_id)
  throw new Error(`Cannot resolve OSM area for: ${location}`)
}

async function findChurchesInArea(location: string): Promise<any[]> {
  const areaId = await getOsmAreaId(location)
  const query = `
    [out:json][timeout:60][maxsize:50000000];
    area(${areaId})->.loc;
    (
      node["amenity"="place_of_worship"]["religion"="christian"](area.loc);
      way["amenity"="place_of_worship"]["religion"="christian"](area.loc);
    );
    out center tags;
  `.trim()

  for (const endpoint of [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ]) {
    const res = await fetch(endpoint, { method: 'POST', body: query, headers: { 'Content-Type': 'text/plain', 'User-Agent': 'FindAPillar/1.0' } })
    if (res.ok) return ((await res.json()) as any).elements ?? []
    console.warn(`  Overpass ${endpoint} → ${res.status}`)
  }
  throw new Error('All Overpass endpoints failed')
}

// ── Web scraping ──────────────────────────────────────────────────────────────

interface PageData {
  text: string
  ogImage: string | null
  socialLinks: { facebook?: string; instagram?: string; youtube?: string; twitter?: string }
}

function extractMeta(html: string, ...patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const m = html.match(p)
    if (m?.[1]) return m[1]
  }
  return null
}

async function fetchPage(url: string): Promise<{ html: string; finalUrl: string } | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      redirect: 'follow',
    })
    if (!res.ok) return null
    return { html: await res.text(), finalUrl: res.url ?? url }
  } catch {
    return null
  }
}

async function scrapePage(url: string): Promise<PageData> {
  const result = await fetchPage(url)
  if (!result) return { text: '', ogImage: null, socialLinks: {} }
  const { html } = result

  // Extract og:image / twitter:image
  const ogImage = extractMeta(html,
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image/i,
  )

  let coverPhoto: string | null = null
  if (ogImage) {
    try { coverPhoto = new URL(ogImage, url).href } catch { coverPhoto = ogImage.startsWith('http') ? ogImage : null }
  }

  // Extract social links
  const fbMatch = html.match(/https?:\/\/(?:www\.)?facebook\.com\/(?!sharer|share|dialog|plugins|login)([a-zA-Z0-9._-]{3,})\/?(?=[^"'<\s]|["'\s])/i)
  const igMatch = html.match(/https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9._]{2,})\/?(?=[^"'<\s]|["'\s])/i)
  const ytMatch = html.match(/https?:\/\/(?:www\.)?youtube\.com\/(?:c\/|channel\/|@)([a-zA-Z0-9._-]{2,})\/?/i)
  const twMatch = html.match(/https?:\/\/(?:www\.)?(?:twitter|x)\.com\/([a-zA-Z0-9_]{1,15})\/?(?=[^"'<\s]|["'\s])/i)

  const socialLinks: PageData['socialLinks'] = {}
  if (fbMatch) socialLinks.facebook = fbMatch[0].split(/["'\s]/)[0]
  if (igMatch) socialLinks.instagram = igMatch[0].split(/["'\s]/)[0]
  if (ytMatch) socialLinks.youtube = ytMatch[0].split(/["'\s]/)[0]
  if (twMatch) socialLinks.twitter = twMatch[0].split(/["'\s]/)[0]

  // Clean text
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<(h[1-6]|p|div|section|article|li|br|tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 30_000)

  return { text, ogImage: coverPhoto, socialLinks }
}

// ── Facebook enrichment ───────────────────────────────────────────────────────

interface FacebookData {
  followers: number | null
  coverPhoto: string | null
}

async function scrapeFacebook(fbUrl: string): Promise<FacebookData> {
  const result = await fetchPage(fbUrl)
  if (!result) return { followers: null, coverPhoto: null }
  const { html } = result

  // Facebook often embeds follower counts in meta description or JSON-LD
  const followersMatch = html.match(/(\d[\d,]+)\s*(?:people\s+)?follow/i)
    ?? html.match(/"follower_count":(\d+)/i)
    ?? html.match(/(\d[\d,.]+[KkMm]?)\s*Followers/i)

  let followers: number | null = null
  if (followersMatch?.[1]) {
    const raw = followersMatch[1].replace(/,/g, '')
    if (raw.match(/[Kk]$/)) followers = Math.round(parseFloat(raw) * 1000)
    else if (raw.match(/[Mm]$/)) followers = Math.round(parseFloat(raw) * 1_000_000)
    else followers = parseInt(raw) || null
  }

  // Try og:image from Facebook page (usually the cover photo)
  const coverPhoto = extractMeta(html,
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
  )

  return { followers, coverPhoto: coverPhoto ?? null }
}

// ── Google reviews ────────────────────────────────────────────────────────────

interface GoogleData {
  reviewCount: number | null
  reviewText: string
}

async function scrapeGoogleReviews(name: string, city: string | null, state: string | null): Promise<GoogleData> {
  try {
    const query = encodeURIComponent(`${name} church ${city ?? ''} ${state ?? ''}`)
    const url = `https://www.google.com/search?q=${query}&num=5`
    const result = await fetchPage(url)
    if (!result) return { reviewCount: null, reviewText: '' }

    const { html } = result

    // Extract review count
    const reviewMatch = html.match(/(\d[\d,]+)\s+(?:Google\s+)?reviews?/i)
      ?? html.match(/"reviewCount":"(\d+)"/i)
    const reviewCount = reviewMatch?.[1] ? parseInt(reviewMatch[1].replace(/,/g, '')) : null

    // Extract review snippets (useful for tagging)
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 8000)

    return { reviewCount, reviewText: text }
  } catch {
    return { reviewCount: null, reviewText: '' }
  }
}

// ── Size estimation ───────────────────────────────────────────────────────────

function estimateSize(extracted: any, fbFollowers: number | null): 'small' | 'medium' | 'large' | null {
  // Use explicit attendance if the LLM found it
  if (extracted.average_attendance) {
    if (extracted.average_attendance >= 1000) return 'large'
    if (extracted.average_attendance >= 200) return 'medium'
    return 'small'
  }
  // Fall back to Facebook followers
  if (fbFollowers) {
    if (fbFollowers >= 2000) return 'large'
    if (fbFollowers >= 500) return 'medium'
    return 'small'
  }
  // Fall back to LLM's size estimate
  if (extracted.size_estimate) return extracted.size_estimate
  return null
}

// ── LLM extraction ────────────────────────────────────────────────────────────

async function extractChurchData(
  name: string, address: string, phone: string | null, website: string,
  osmDenomination: string | null, websiteText: string,
  socialLinks: PageData['socialLinks'], fbFollowers: number | null,
  googleReviewText: string, googleReviewCount: number | null,
) {
  const socialContext = Object.entries(socialLinks).map(([k, v]) => `${k}: ${v}`).join(', ')

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 3000,
    messages: [{
      role: 'user',
      content: `Extract structured church directory data. Be thorough — scan ALL sources carefully including Google review text. Return ONLY valid JSON, no markdown.

Source:
- Name: ${name}
- Address: ${address}
- Phone: ${phone ?? 'unknown'}
- Website: ${website}
- OSM denomination: ${osmDenomination ?? 'unknown'}
- Social media: ${socialContext || 'none'}
- Facebook followers: ${fbFollowers ?? 'unknown'}
- Google review count: ${googleReviewCount ?? 'unknown'}

Website text:
${websiteText || '(none)'}

Google search/review snippets (USE THESE for tags — reviews often reveal theology, style, community):
${googleReviewText || '(none)'}

Return JSON (omit fields you cannot find — never guess):
{
  "name": string,
  "description": string | null,
  "street_address": string | null,
  "city": string | null,
  "state": string | null,
  "zip": string | null,
  "phone": string | null,
  "email": string | null,
  "founded_year": number | null,
  "average_attendance": number | null,
  "size_estimate": "small" | "medium" | "large" | null,
  "denomination_name": string | null,
  "service_style": "traditional" | "contemporary" | "blended" | "liturgical" | null,
  "core_beliefs": { "statement": string, "beliefs": string[] } | null,
  "tags": string[],
  "pastors": [{
    "name": string,
    "title": string | null,
    "bio": string | null,
    "is_primary": boolean,
    "seminary": string | null
  }],
  "meeting_times": [{
    "day_of_week": number,
    "start_time": "HH:MM:SS",
    "end_time": string | null,
    "service_name": string | null
  }]
}

RULES:
- tags: infer from ALL sources including Google reviews. If reviews/responses mention Calvinist/Reformed theology → "reformed". If LGBTQ-welcoming language anywhere → "lgbt-affirming". Etc. Valid tags: ${VALID_TAGS.join(', ')}
- size_estimate: use ALL signals — attendance numbers, staff count, service count, multi-campus, "thousands", Facebook followers (${fbFollowers ?? 'unknown'}), Google review count (${googleReviewCount ?? 'unknown'}, more reviews = larger church). small=<200, medium=200-1000, large=1000+
- seminary: look in pastor bios for "M.Div.", "Th.M.", "D.Min.", "graduated from", "studied at", named seminaries (Fuller, Princeton, Dallas Theological, Wheaton, Gordon-Conwell, Reformed Theological, Covenant, etc.)
- average_attendance: look for "congregation of X", "X members", "X weekly", "serves X people"`
    }],
  })

  const raw = ((msg.content[0] as any).text ?? '').trim()
  const json = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  return JSON.parse(json)
}

// ── Denomination lookup ───────────────────────────────────────────────────────

async function findDenomination(name: string | null) {
  if (!name) return { id: null, path: null }
  let { data } = await supabase.from('denominations').select('id, name, parent_id').ilike('name', name).limit(1).single()
  if (!data) {
    const word = name.split(/\s+/).find(w => w.length > 4)
    if (word) ({ data } = await supabase.from('denominations').select('id, name, parent_id').ilike('name', `%${word}%`).limit(1).single())
  }
  if (!data) return { id: null, path: null }
  const path: string[] = [data.name]
  let cur = data
  for (let i = 0; i < 5 && cur.parent_id; i++) {
    const { data: p } = await supabase.from('denominations').select('id, name, parent_id').eq('id', cur.parent_id).single()
    if (!p) break
    path.unshift(p.name)
    cur = p
  }
  return { id: data.id, path }
}

// ── Upsert ────────────────────────────────────────────────────────────────────

function toSlug(name: string, city: string | null) {
  return `${name}-${city ?? ''}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

async function upsertChurch(extracted: any, lat: number | null, lng: number | null, website: string | null, coverPhoto: string | null, size: 'small' | 'medium' | 'large' | null, denomResult: any) {
  const serviceStyle = ['traditional', 'contemporary', 'blended', 'liturgical'].includes(extracted.service_style) ? extracted.service_style : null

  const { data: church, error } = await supabase
    .from('churches')
    .upsert({
      name: extracted.name,
      slug: toSlug(extracted.name, extracted.city),
      description: extracted.description ?? null,
      street_address: extracted.street_address ?? null,
      city: extracted.city ?? null,
      state: extracted.state ?? null,
      zip: extracted.zip ?? null,
      lat, lng, website,
      phone: extracted.phone ?? null,
      email: extracted.email ?? null,
      founded_year: extracted.founded_year ?? null,
      average_attendance: extracted.average_attendance ?? null,
      size,
      cover_photo: coverPhoto,
      denomination_id: denomResult.id,
      denomination_path: denomResult.path,
      service_style: serviceStyle,
      core_beliefs: extracted.core_beliefs ?? null,
      is_verified: false,
      is_active: true,
      enriched: true,
    }, { onConflict: 'slug' })
    .select('id').single()

  if (error) throw error
  const id = church.id

  if (extracted.pastors?.length) {
    await supabase.from('pastors').delete().eq('church_id', id)
    await supabase.from('pastors').insert(
      extracted.pastors.map((p: any) => ({ name: p.name, title: p.title ?? null, bio: p.bio ?? null, is_primary: p.is_primary ?? false, seminary: p.seminary ?? null, church_id: id }))
    )
  }
  if (extracted.meeting_times?.length) {
    await supabase.from('meeting_times').delete().eq('church_id', id)
    await supabase.from('meeting_times').insert(extracted.meeting_times.map((m: any) => ({ ...m, church_id: id })))
  }
  if (extracted.tags?.length) {
    const valid = extracted.tags.filter((t: string) => VALID_TAGS.includes(t))
    if (valid.length) {
      await supabase.from('church_tags').delete().eq('church_id', id)
      await supabase.from('church_tags').insert(valid.map((tag: string) => ({ church_id: id, tag })))
    }
  }
  return id
}

async function saveOsmOnlyBatch(places: any[]) {
  const rows = places.filter(p => p.tags?.name).map((place: any) => {
    const tags = place.tags ?? {}
    const name = tags['name'] ?? tags['name:en']
    const city = tags['addr:city'] ?? null
    return {
      name, slug: toSlug(name, city),
      street_address: [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ') || null,
      city, state: tags['addr:state'] ?? null, zip: tags['addr:postcode'] ?? null,
      lat: place.lat ?? place.center?.lat ?? null, lng: place.lon ?? place.center?.lon ?? null,
      phone: tags['phone'] ?? tags['contact:phone'] ?? null,
      is_verified: false, is_active: true, enriched: false,
    }
  })
  for (let i = 0; i < rows.length; i += 100) {
    await supabase.from('churches').upsert(rows.slice(i, i + 100), { onConflict: 'slug', ignoreDuplicates: true })
  }
  return rows.length
}

// ── Process a single church ───────────────────────────────────────────────────

async function processChurch(place: any, force: boolean): Promise<'enriched' | 'skipped' | 'error'> {
  const tags = place.tags ?? {}
  const name = tags['name'] ?? tags['name:en'] ?? 'Unknown Church'
  const website = (() => {
    const raw = tags['website'] ?? tags['contact:website'] ?? tags['url'] ?? null
    if (!raw) return null
    return raw.startsWith('http') ? raw : `https://${raw}`
  })()

  if (!website) return 'skipped'

  const lat = place.lat ?? place.center?.lat ?? null
  const lng = place.lon ?? place.center?.lon ?? null
  const slug = toSlug(name, tags['addr:city'] ?? null)

  // Check if already enriched
  if (!force) {
    const { data } = await supabase.from('churches').select('enriched').eq('slug', slug).single()
    if (data?.enriched) {
      process.stdout.write(`  ⟳ ${name} (already enriched — skipping)\n`)
      return 'skipped'
    }
  }

  try {
    // 1. Scrape main website
    const { text, ogImage, socialLinks } = await scrapePage(website)

    // 2. Try Facebook for extra data
    let fbData: FacebookData = { followers: null, coverPhoto: null }
    if (socialLinks.facebook) {
      fbData = await scrapeFacebook(socialLinks.facebook)
    }

    // 3. Pick best photo: og:image from site > Facebook cover > null
    const coverPhoto = ogImage ?? fbData.coverPhoto ?? null

    // 4. Google reviews
    const { reviewCount, reviewText } = await scrapeGoogleReviews(name, tags['addr:city'] ?? null, tags['addr:state'] ?? null)

    // 5. LLM extraction
    const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ')
    const address = [street, tags['addr:city'], tags['addr:state'], tags['addr:postcode']].filter(Boolean).join(', ') || ''
    const extracted = await extractChurchData(name, address, tags['phone'] ?? tags['contact:phone'] ?? null, website, tags['denomination'] ?? null, text, socialLinks, fbData.followers, reviewText, reviewCount)

    // 6. Estimate size
    const size = estimateSize(extracted, fbData.followers ?? reviewCount)

    // 7. Denomination match
    const denomResult = await findDenomination(extracted.denomination_name ?? tags['denomination'] ?? null)

    // 8. Upsert
    await upsertChurch(extracted, lat, lng, website, coverPhoto, size, denomResult)

    const extras = [
      coverPhoto ? '📷' : '',
      size ? size : '',
      fbData.followers ? `fb:${fbData.followers.toLocaleString()}` : '',
      extracted.pastors?.some((p: any) => p.seminary) ? '🎓' : '',
    ].filter(Boolean).join(' ')
    process.stdout.write(`  ✓ ${extracted.name ?? name}${extracted.city ? ` (${extracted.city})` : ''} ${extras}\n`)
    return 'enriched'
  } catch (err: any) {
    process.stdout.write(`  ✗ ${name}: ${err.message.slice(0, 80)}\n`)
    return 'error'
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const get = (flag: string) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : undefined }

  const city = get('--city')
  const county = get('--county')
  const state = get('--state')
  const force = args.includes('--force')
  const concurrency = parseInt(get('--concurrency') ?? '3')

  if (!city && !county) {
    console.error('Usage: npx tsx scripts/scrape.ts --city "Austin" --state "TX"')
    console.error('       npx tsx scripts/scrape.ts --county "Wayne" --state "MI" [--force] [--concurrency 3]')
    process.exit(1)
  }

  const location = county ? `${county} County, ${state ?? ''}` : `${city}, ${state ?? ''}`
  console.log(`\nFinding churches in: ${location}`)
  if (force) console.log('  --force: re-enriching already-enriched churches\n')

  const places = await findChurchesInArea(location)
  const withWebsites = places.filter(p => {
    const raw = p.tags?.['website'] ?? p.tags?.['contact:website'] ?? p.tags?.['url'] ?? null
    return !!raw
  })
  const withoutWebsites = places.filter(p => {
    const raw = p.tags?.['website'] ?? p.tags?.['contact:website'] ?? p.tags?.['url'] ?? null
    return !raw
  })

  console.log(`Found ${places.length} churches total`)
  console.log(`  ${withWebsites.length} have websites (will fully enrich)`)
  console.log(`  ${withoutWebsites.length} no website (will save basic OSM data)\n`)

  // Save OSM-only churches first (fast batch operation)
  const osmSaved = await saveOsmOnlyBatch(withoutWebsites)
  console.log(`Saved ${osmSaved} OSM-only churches\n`)
  console.log(`Enriching ${withWebsites.length} churches (concurrency: ${concurrency})...\n`)

  // Process with limited concurrency
  let enriched = 0, skipped = 0, errors = 0
  for (let i = 0; i < withWebsites.length; i += concurrency) {
    const batch = withWebsites.slice(i, i + concurrency)
    const results = await Promise.all(batch.map(p => processChurch(p, force)))
    for (const r of results) {
      if (r === 'enriched') enriched++
      else if (r === 'skipped') skipped++
      else errors++
    }
  }

  console.log(`\nDone!`)
  console.log(`  Enriched:  ${enriched}`)
  console.log(`  Skipped:   ${skipped} (already enriched or no website)`)
  console.log(`  Errors:    ${errors}`)
  console.log(`  OSM-only:  ${osmSaved}`)
}

main().catch(err => { console.error(err); process.exit(1) })
