#!/usr/bin/env tsx
/**
 * FindAPillar church scraper — Google Places API primary, OSM fallback.
 *
 * With GOOGLE_PLACES_API_KEY set (recommended):
 *   - Discovers churches via Google Places Text Search
 *   - Pulls rating, review count, hours, phone, address, photos, reviews
 *   - If the church has a website, scrapes it for doctrine, pastors, etc.
 *   - Saves reviews to church_reviews table
 *
 * Without GOOGLE_PLACES_API_KEY:
 *   - Falls back to OpenStreetMap (Overpass API) discovery
 *   - Scrapes church websites for enrichment
 *
 * Usage:
 *   npx tsx scripts/scrape.ts --city "Austin" --state "TX"
 *   npx tsx scripts/scrape.ts --county "Wayne" --state "MI"
 *   npx tsx scripts/scrape.ts --city "Dallas" --state "TX" --force
 *   npx tsx scripts/scrape.ts --city "Atlanta" --state "GA" --concurrency 5
 */

import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), 'scripts/.env') })

const SUPABASE_URL              = process.env['SUPABASE_URL']!
const SUPABASE_SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY']!
const ANTHROPIC_API_KEY         = process.env['ANTHROPIC_API_KEY']!
const GOOGLE_PLACES_API_KEY     = process.env['GOOGLE_PLACES_API_KEY'] ?? ''

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !ANTHROPIC_API_KEY) {
  console.error('Missing required env vars. Check scripts/.env')
  process.exit(1)
}

const supabase  = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

const VALID_TAGS = [
  'lgbt-affirming', 'women-pastors', 'missions-focused', 'social-justice',
  'charismatic', 'reformed', 'evangelical', 'progressive', 'conservative',
  'multi-ethnic', 'young-adults', 'families', 'seniors', 'recovery-ministry',
  'spanish-service', 'korean-service', 'chinese-service', 'deaf-ministry',
  'prison-ministry', 'food-pantry', 'counseling',
]

// ── Types ─────────────────────────────────────────────────────────────────────

interface PageData {
  text: string
  ogImage: string | null
  socialLinks: SocialLinks
}

interface SocialLinks {
  facebook?: string
  instagram?: string
  youtube?: string
  twitter?: string
  tiktok?: string
}

interface FacebookData {
  followers: number | null
  coverPhoto: string | null
}

interface ChurchRecord {
  name: string
  lat: number | null
  lng: number | null
  website: string | null
  phone: string | null
  address: string
  osmDenomination: string | null
  // Google Places extras
  googlePlaceId?: string
  googleRating?: number | null
  googleReviewCount?: number | null
  googleMapsUrl?: string | null
  googlePhotos?: string[]
  googleReviews?: GoogleReview[]
  googleHours?: ChurchHours
}

interface GooglePlaceBasic {
  id: string
  displayName?: { text: string }
  formattedAddress?: string
  location?: { latitude: number; longitude: number }
  rating?: number
  userRatingCount?: number
  websiteUri?: string
  googleMapsUri?: string
}

interface GoogleReview {
  authorAttribution?: { displayName?: string }
  rating?: number
  text?: { text?: string }
  publishTime?: string
}

interface GooglePlaceDetails extends GooglePlaceBasic {
  internationalPhoneNumber?: string
  regularOpeningHours?: {
    periods?: {
      open?: { day?: number; hour?: number; minute?: number }
      close?: { day?: number; hour?: number; minute?: number }
    }[]
  }
  photos?: { name: string }[]
  reviews?: GoogleReview[]
  addressComponents?: { longText: string; shortText: string; types: string[] }[]
}

type ChurchHours = Record<string, { open: string; close: string }[]>

// ── Google Places API ─────────────────────────────────────────────────────────

const PLACES_BASE = 'https://places.googleapis.com/v1'

async function placesTextSearch(
  query: string, pageToken?: string
): Promise<{ places: GooglePlaceBasic[]; nextPageToken?: string }> {
  const body: Record<string, unknown> = {
    textQuery: query,
    maxResultCount: 20,
    languageCode: 'en',
    includedType: 'church',
  }
  if (pageToken) body['pageToken'] = pageToken

  const res = await fetch(`${PLACES_BASE}/places:searchText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask': [
        'places.id', 'places.displayName', 'places.formattedAddress',
        'places.location', 'places.rating', 'places.userRatingCount',
        'places.websiteUri', 'places.googleMapsUri', 'nextPageToken',
      ].join(','),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Places Text Search ${res.status}: ${await res.text()}`)
  const data = await res.json() as any
  return { places: data.places ?? [], nextPageToken: data.nextPageToken }
}

async function placesGetDetails(placeId: string): Promise<GooglePlaceDetails> {
  const res = await fetch(`${PLACES_BASE}/places/${placeId}`, {
    headers: {
      'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask': [
        'id', 'displayName', 'formattedAddress', 'location',
        'internationalPhoneNumber', 'websiteUri', 'googleMapsUri',
        'rating', 'userRatingCount',
        'regularOpeningHours', 'photos', 'reviews', 'addressComponents',
      ].join(','),
    },
  })
  if (!res.ok) throw new Error(`Places Details ${res.status}: ${await res.text()}`)
  return res.json()
}

/** Returns a Street View Static API URL if imagery exists at these coords, null otherwise */
async function resolveStreetViewUrl(lat: number, lng: number): Promise<string | null> {
  if (!GOOGLE_PLACES_API_KEY) return null
  const meta = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&key=${GOOGLE_PLACES_API_KEY}`
  try {
    const res = await fetch(meta)
    if (!res.ok) return null
    const data = await res.json() as any
    if (data.status !== 'OK') return null
    return `https://maps.googleapis.com/maps/api/streetview?size=800x500&location=${lat},${lng}&fov=90&pitch=5&key=${GOOGLE_PLACES_API_KEY}`
  } catch {
    return null
  }
}

/** Resolves a Places photo name to a direct CDN image URL (no API key in stored URL) */
async function resolvePhotoUrl(photoName: string, maxW = 1200, maxH = 900): Promise<string | null> {
  const url = `${PLACES_BASE}/${photoName}/media?maxWidthPx=${maxW}&maxHeightPx=${maxH}&skipHttpRedirect=true&key=${GOOGLE_PLACES_API_KEY}`
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json() as any
    return data.photoUri ?? null
  } catch {
    return null
  }
}

function convertGoogleHours(hours: GooglePlaceDetails['regularOpeningHours']): ChurchHours {
  if (!hours?.periods) return {}
  const result: ChurchHours = {}
  for (const period of hours.periods) {
    const day = String(period.open?.day ?? 0)
    const open  = `${String(period.open?.hour  ?? 0).padStart(2, '0')}:${String(period.open?.minute  ?? 0).padStart(2, '0')}`
    const close = period.close
      ? `${String(period.close.hour ?? 0).padStart(2, '0')}:${String(period.close.minute ?? 0).padStart(2, '0')}`
      : ''
    if (!result[day]) result[day] = []
    result[day].push({ open, close })
  }
  return result
}

/** Collect all pages of church results for a city/state */
async function discoverViaGooglePlaces(city: string, state: string): Promise<ChurchRecord[]> {
  const query = `churches in ${city} ${state}`
  console.log(`  → Google Places: "${query}"`)

  const records: ChurchRecord[] = []
  let pageToken: string | undefined

  do {
    const { places, nextPageToken } = await placesTextSearch(query, pageToken)
    pageToken = nextPageToken

    for (const place of places) {
      if (!place.id) continue
      try {
        const details = await placesGetDetails(place.id)
        const photos  = (await Promise.all(
          (details.photos ?? []).slice(0, 5).map(p => resolvePhotoUrl(p.name))
        )).filter((u): u is string => !!u)
        const reviews = (details.reviews ?? []).map(r => ({
          authorAttribution: r.authorAttribution,
          rating: r.rating,
          text: r.text,
          publishTime: r.publishTime,
        }))

        // Parse address components
        const comps = details.addressComponents ?? []
        const getComp = (type: string) => comps.find(c => c.types.includes(type))?.longText ?? null

        records.push({
          name:              details.displayName?.text ?? place.displayName?.text ?? 'Unknown Church',
          lat:               details.location?.latitude  ?? null,
          lng:               details.location?.longitude ?? null,
          website:           details.websiteUri ?? null,
          phone:             details.internationalPhoneNumber ?? null,
          address:           details.formattedAddress ?? '',
          osmDenomination:   null,
          googlePlaceId:     details.id,
          googleRating:      details.rating ?? null,
          googleReviewCount: details.userRatingCount ?? null,
          googleMapsUrl:     details.googleMapsUri ?? null,
          googlePhotos:      photos,
          googleReviews:     reviews,
          googleHours:       convertGoogleHours(details.regularOpeningHours),
        })
        process.stdout.write('.')
      } catch (err: any) {
        process.stdout.write('x')
      }
    }

    if (nextPageToken) await delay(500) // be polite between pages
  } while (pageToken)

  process.stdout.write('\n')
  return records
}

// ── OSM fallback ──────────────────────────────────────────────────────────────

async function getOsmAreaId(location: string): Promise<number> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1`,
    { headers: { 'User-Agent': 'FindAPillar/1.0' } }
  )
  const data = await res.json() as any[]
  if (!data?.length) throw new Error(`No geocoding results for: ${location}`)
  const hit = data[0]
  if (hit.osm_type === 'relation') return 3_600_000_000 + parseInt(hit.osm_id)
  if (hit.osm_type === 'way')      return 2_400_000_000 + parseInt(hit.osm_id)
  throw new Error(`Cannot resolve OSM area for: ${location}`)
}

async function discoverViaOsm(location: string): Promise<any[]> {
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
    const res = await fetch(endpoint, {
      method: 'POST', body: query,
      headers: { 'Content-Type': 'text/plain', 'User-Agent': 'FindAPillar/1.0' },
    })
    if (res.ok) return ((await res.json()) as any).elements ?? []
    console.warn(`  Overpass ${endpoint} → ${res.status}`)
  }
  throw new Error('All Overpass endpoints failed')
}

function osmPlaceToRecord(place: any): ChurchRecord {
  const tags = place.tags ?? {}
  const name = tags['name'] ?? tags['name:en'] ?? 'Unknown Church'
  const rawUrl = tags['website'] ?? tags['contact:website'] ?? tags['url'] ?? null
  const website = rawUrl ? (rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`) : null
  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ')
  const address = [street, tags['addr:city'], tags['addr:state'], tags['addr:postcode']].filter(Boolean).join(', ')
  return {
    name, website,
    lat: place.lat ?? place.center?.lat ?? null,
    lng: place.lon ?? place.center?.lon ?? null,
    phone: tags['phone'] ?? tags['contact:phone'] ?? null,
    address,
    osmDenomination: tags['denomination'] ?? null,
  }
}

// ── Web scraping ──────────────────────────────────────────────────────────────

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

  const ogImage = extractMeta(html,
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
  )

  let coverPhoto: string | null = null
  if (ogImage) {
    try { coverPhoto = new URL(ogImage, url).href } catch { coverPhoto = ogImage.startsWith('http') ? ogImage : null }
  }

  const fbMatch = html.match(/https?:\/\/(?:www\.)?facebook\.com\/(?!sharer|share|dialog|plugins|login)([a-zA-Z0-9._-]{3,})\/?(?=[^"'<\s]|["'\s])/i)
  const igMatch = html.match(/https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9._]{2,})\/?(?=[^"'<\s]|["'\s])/i)
  const ytMatch = html.match(/https?:\/\/(?:www\.)?youtube\.com\/(?:c\/|channel\/|@)([a-zA-Z0-9._-]{2,})\/?/i)
  const twMatch = html.match(/https?:\/\/(?:www\.)?(?:twitter|x)\.com\/([a-zA-Z0-9_]{1,15})\/?(?=[^"'<\s]|["'\s])/i)
  const tkMatch = html.match(/https?:\/\/(?:www\.)?tiktok\.com\/@([a-zA-Z0-9._]{2,})\/?/i)

  const socialLinks: SocialLinks = {}
  if (fbMatch) socialLinks.facebook  = fbMatch[0].split(/["'\s]/)[0]
  if (igMatch) socialLinks.instagram = igMatch[0].split(/["'\s]/)[0]
  if (ytMatch) socialLinks.youtube   = ytMatch[0].split(/["'\s]/)[0]
  if (twMatch) socialLinks.twitter   = twMatch[0].split(/["'\s]/)[0]
  if (tkMatch) socialLinks.tiktok    = tkMatch[0].split(/["'\s]/)[0]

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

async function scrapeFacebook(fbUrl: string): Promise<FacebookData> {
  const result = await fetchPage(fbUrl)
  if (!result) return { followers: null, coverPhoto: null }
  const { html } = result

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

  const coverPhoto = extractMeta(html,
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
  )
  return { followers, coverPhoto: coverPhoto ?? null }
}

// ── Size estimation ───────────────────────────────────────────────────────────

function estimateSize(
  attendance: number | null, fbFollowers: number | null, reviewCount: number | null, llmEstimate: string | null
): 'small' | 'medium' | 'large' | null {
  if (attendance) {
    if (attendance >= 1000) return 'large'
    if (attendance >= 200)  return 'medium'
    return 'small'
  }
  if (fbFollowers) {
    if (fbFollowers >= 2000) return 'large'
    if (fbFollowers >= 500)  return 'medium'
    return 'small'
  }
  // Google review count is a decent proxy for church size
  if (reviewCount) {
    if (reviewCount >= 150) return 'large'
    if (reviewCount >= 40)  return 'medium'
    return 'small'
  }
  if (llmEstimate && ['small','medium','large'].includes(llmEstimate)) return llmEstimate as any
  return null
}

// ── LLM extraction ────────────────────────────────────────────────────────────

async function extractChurchData(
  name: string, address: string, phone: string | null, website: string,
  osmDenomination: string | null, websiteText: string,
  socialLinks: SocialLinks, fbFollowers: number | null,
  reviewCount: number | null, googleRating: number | null,
  reviewSnippets: string,
) {
  const socialCtx = Object.entries(socialLinks).map(([k, v]) => `${k}: ${v}`).join(', ')

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 3000,
    messages: [{
      role: 'user',
      content: `Extract structured church directory data. Be thorough — scan ALL sources carefully. Return ONLY valid JSON, no markdown.

Source data:
- Name: ${name}
- Address: ${address}
- Phone: ${phone ?? 'unknown'}
- Website: ${website}
- OSM denomination tag: ${osmDenomination ?? 'unknown'}
- Social media found: ${socialCtx || 'none'}
- Facebook followers: ${fbFollowers ?? 'unknown'}
- Google rating: ${googleRating ?? 'unknown'}/5
- Google review count: ${reviewCount ?? 'unknown'}

Website text (primary source for doctrine/pastors/beliefs):
${websiteText || '(none)'}

Google review snippets (useful for theology/culture tags):
${reviewSnippets || '(none)'}

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
- tags: infer from ALL sources. Reviews revealing Reformed theology → "reformed". LGBTQ-welcoming language → "lgbt-affirming". Etc. Valid tags: ${VALID_TAGS.join(', ')}
- size_estimate: use ALL signals — attendance numbers, staff count, service count, multi-campus mentions, "thousands", Facebook followers, Google review count (more reviews = larger church). small=<200, medium=200-1000, large=1000+
- seminary: look in pastor bios for M.Div., Th.M., D.Min., "graduated from", named seminaries (Fuller, Princeton, Dallas Theological, Wheaton, Gordon-Conwell, Reformed Theological, Covenant, etc.)
- average_attendance: look for "congregation of X", "X members", "X weekly", "serves X people", "X families"`,
    }],
  })

  const raw = ((msg.content[0] as any).text ?? '').trim()
  const json = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  return JSON.parse(json)
}

// ── Denomination lookup ───────────────────────────────────────────────────────

// Map LLM denomination strings that don't exist verbatim in the DB
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
  if (!name) return { id: null, path: null }

  // Apply alias mapping first
  let lookupName = name
  for (const [pattern, alias] of DENOM_ALIASES) {
    if (pattern.test(name)) { lookupName = alias; break }
  }

  let { data } = await supabase.from('denominations').select('id, name, parent_id').ilike('name', lookupName).limit(1).maybeSingle()
  if (!data && lookupName !== name) {
    // Alias didn't match exactly — try original name
    ;({ data } = await supabase.from('denominations').select('id, name, parent_id').ilike('name', name).limit(1).maybeSingle() as any)
  }
  if (!data) {
    const word = name.split(/\s+/).find(w => w.length > 4)
    if (word) ({ data } = await supabase.from('denominations').select('id, name, parent_id').ilike('name', `%${word}%`).limit(1).maybeSingle() as any)
  }
  if (!data) return { id: null, path: null }
  const path: string[] = [data.name]
  let cur = data
  for (let i = 0; i < 5 && cur.parent_id; i++) {
    const { data: p } = await supabase.from('denominations').select('id, name, parent_id').eq('id', cur.parent_id).maybeSingle()
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

async function upsertChurch(opts: {
  extracted: any
  record: ChurchRecord
  coverPhoto: string | null
  photos: string[]
  size: 'small' | 'medium' | 'large' | null
  denomResult: { id: string | null; path: string[] | null }
  socialLinks: SocialLinks
}) {
  const { extracted, record, coverPhoto, photos, size, denomResult, socialLinks } = opts
  const serviceStyle = ['traditional','contemporary','blended','liturgical'].includes(extracted.service_style)
    ? extracted.service_style : null

  const { data: church, error } = await supabase
    .from('churches')
    .upsert({
      name:                 extracted.name ?? record.name,
      slug:                 toSlug(extracted.name ?? record.name, extracted.city),
      description:          extracted.description ?? null,
      street_address:       extracted.street_address ?? null,
      city:                 extracted.city ?? null,
      state:                extracted.state ?? null,
      zip:                  extracted.zip ?? null,
      lat:                  record.lat,
      lng:                  record.lng,
      website:              record.website,
      phone:                extracted.phone ?? record.phone ?? null,
      email:                extracted.email ?? null,
      founded_year:         extracted.founded_year ?? null,
      average_attendance:   extracted.average_attendance ?? null,
      size,
      cover_photo:          coverPhoto,
      photos:               photos,
      denomination_id:      denomResult.id,
      denomination_path:    denomResult.path,
      service_style:        serviceStyle,
      core_beliefs:         extracted.core_beliefs ?? null,
      social_links:         Object.keys(socialLinks).length ? socialLinks : null,
      hours:                record.googleHours && Object.keys(record.googleHours).length ? record.googleHours : null,
      google_place_id:      record.googlePlaceId ?? null,
      google_rating:        record.googleRating ?? null,
      google_review_count:  record.googleReviewCount ?? null,
      google_maps_url:      record.googleMapsUrl ?? null,
      is_verified:          false,
      is_active:            true,
      enriched:             true,
      last_scraped_at:      new Date().toISOString(),
    }, { onConflict: 'slug' })
    .select('id').single()

  if (error) throw error
  const id = church.id

  if (extracted.pastors?.length) {
    await supabase.from('pastors').delete().eq('church_id', id)
    await supabase.from('pastors').insert(
      extracted.pastors.map((p: any) => ({
        name: p.name, title: p.title ?? null, bio: p.bio ?? null,
        is_primary: p.is_primary ?? false, seminary: p.seminary ?? null, church_id: id,
      }))
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

  // Save Google reviews
  if (record.googleReviews?.length) {
    await supabase.from('church_reviews').delete().eq('church_id', id)
    const reviewRows = record.googleReviews
      .filter(r => r.text?.text)
      .map(r => ({
        church_id:   id,
        author_name: r.authorAttribution?.displayName ?? null,
        rating:      r.rating ?? null,
        text:        r.text?.text ?? null,
        review_date: r.publishTime ? r.publishTime.split('T')[0] : null,
        source:      'google',
      }))
    if (reviewRows.length) await supabase.from('church_reviews').insert(reviewRows)
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
      lat: place.lat ?? place.center?.lat ?? null,
      lng: place.lon ?? place.center?.lon ?? null,
      phone: tags['phone'] ?? tags['contact:phone'] ?? null,
      is_verified: false, is_active: true, enriched: false,
    }
  })
  for (let i = 0; i < rows.length; i += 100) {
    await supabase.from('churches').upsert(rows.slice(i, i + 100), { onConflict: 'slug', ignoreDuplicates: true })
  }
  return rows.length
}

// ── Process a single church record ───────────────────────────────────────────

async function processChurch(record: ChurchRecord, force: boolean): Promise<'enriched' | 'skipped' | 'error'> {
  // Check if already enriched (skip if not forced)
  if (!force && (record.googlePlaceId || record.website)) {
    const key = record.googlePlaceId ? 'google_place_id' : 'slug'
    const val = record.googlePlaceId ?? toSlug(record.name, null)
    const { data } = await supabase.from('churches').select('enriched').eq(key, val).maybeSingle()
    if (data?.enriched) {
      process.stdout.write(`  ⟳ ${record.name} (already enriched)\n`)
      return 'skipped'
    }
  }

  try {
    // 1. Scrape website for doctrine/pastors/beliefs
    let websiteData: PageData = { text: '', ogImage: null, socialLinks: {} }
    if (record.website) {
      websiteData = await scrapePage(record.website)
    }

    // 2. Facebook extra data
    let fbData: FacebookData = { followers: null, coverPhoto: null }
    if (websiteData.socialLinks.facebook) {
      fbData = await scrapeFacebook(websiteData.socialLinks.facebook)
    }

    // 3. Build review text for LLM context (from Google reviews)
    const reviewSnippets = (record.googleReviews ?? [])
      .map(r => r.text?.text ?? '')
      .filter(Boolean)
      .join('\n---\n')
      .slice(0, 5000)

    // 4. LLM extraction
    const extracted = await extractChurchData(
      record.name, record.address, record.phone, record.website ?? '',
      record.osmDenomination, websiteData.text,
      { ...websiteData.socialLinks },
      fbData.followers, record.googleReviewCount ?? null,
      record.googleRating ?? null, reviewSnippets,
    )

    // 5. Best available photo (Google Places → og:image → Facebook → Street View exterior)
    const googleCover = record.googlePhotos?.[0] ?? null
    let coverPhoto    = googleCover ?? websiteData.ogImage ?? fbData.coverPhoto ?? null
    if (!coverPhoto && record.lat && record.lng) {
      coverPhoto = await resolveStreetViewUrl(record.lat, record.lng)
    }
    const photos = [
      ...(record.googlePhotos ?? []),
      ...(websiteData.ogImage ? [websiteData.ogImage] : []),
    ].filter((v, i, a) => a.indexOf(v) === i).slice(0, 8)

    // 6. Size estimation
    const size = estimateSize(
      extracted.average_attendance ?? null,
      fbData.followers,
      record.googleReviewCount ?? null,
      extracted.size_estimate ?? null,
    )

    // 7. Denomination matching
    const denomResult = await findDenomination(extracted.denomination_name ?? record.osmDenomination ?? null)

    // 8. Upsert everything
    await upsertChurch({
      extracted, record, coverPhoto, photos, size, denomResult,
      socialLinks: { ...websiteData.socialLinks },
    })

    const extras = [
      coverPhoto ? '📷' : '',
      size ?? '',
      record.googleRating ? `⭐${record.googleRating}` : '',
      record.googleReviewCount ? `${record.googleReviewCount} reviews` : '',
      extracted.pastors?.some((p: any) => p.seminary) ? '🎓' : '',
    ].filter(Boolean).join(' ')
    process.stdout.write(`  ✓ ${extracted.name ?? record.name}${extracted.city ? ` (${extracted.city})` : ''} ${extras}\n`)
    return 'enriched'
  } catch (err: any) {
    process.stdout.write(`  ✗ ${record.name}: ${err.message.slice(0, 80)}\n`)
    return 'error'
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args        = process.argv.slice(2)
  const get         = (flag: string) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : undefined }
  const city        = get('--city')
  const county      = get('--county')
  const state       = get('--state')
  const force       = args.includes('--force')
  const concurrency = parseInt(get('--concurrency') ?? '3')

  if (!city && !county) {
    console.error('Usage: npx tsx scripts/scrape.ts --city "Austin" --state "TX"')
    console.error('       npx tsx scripts/scrape.ts --county "Wayne" --state "MI" [--force] [--concurrency 3]')
    process.exit(1)
  }

  const location = county ? `${county} County, ${state ?? ''}` : `${city}, ${state ?? ''}`
  console.log(`\nFinding churches in: ${location}`)
  if (GOOGLE_PLACES_API_KEY) console.log('  Mode: Google Places API + website enrichment')
  else                        console.log('  Mode: OSM fallback (no Google Places API key)')
  if (force) console.log('  --force: re-enriching already-enriched churches')
  console.log()

  let records: ChurchRecord[] = []
  let osmOnlySaved = 0

  if (GOOGLE_PLACES_API_KEY) {
    // ── Google Places path ────────────────────────────────────
    const target = county ? `${county} County, ${state ?? ''}` : `${city!}, ${state ?? ''}`
    records = await discoverViaGooglePlaces(city ?? county!, state ?? '')
    console.log(`Found ${records.length} churches via Google Places`)
  } else {
    // ── OSM fallback path ─────────────────────────────────────
    const places = await discoverViaOsm(location)
    const withWebsite    = places.filter(p => p.tags?.['website'] ?? p.tags?.['contact:website'] ?? p.tags?.['url'])
    const withoutWebsite = places.filter(p => !(p.tags?.['website'] ?? p.tags?.['contact:website'] ?? p.tags?.['url']))

    console.log(`Found ${places.length} churches via OSM`)
    console.log(`  ${withWebsite.length} have websites (will fully enrich)`)
    console.log(`  ${withoutWebsite.length} no website (saving basic data)\n`)

    osmOnlySaved = await saveOsmOnlyBatch(withoutWebsite)
    console.log(`Saved ${osmOnlySaved} OSM-only churches\n`)

    records = withWebsite.map(osmPlaceToRecord)
  }

  console.log(`Enriching ${records.length} churches (concurrency: ${concurrency})...\n`)

  let enriched = 0, skipped = 0, errors = 0
  for (let i = 0; i < records.length; i += concurrency) {
    const batch   = records.slice(i, i + concurrency)
    const results = await Promise.all(batch.map(r => processChurch(r, force)))
    for (const r of results) {
      if (r === 'enriched') enriched++
      else if (r === 'skipped') skipped++
      else errors++
    }
  }

  console.log(`\nDone!`)
  console.log(`  Enriched:  ${enriched}`)
  console.log(`  Skipped:   ${skipped}`)
  console.log(`  Errors:    ${errors}`)
  if (osmOnlySaved) console.log(`  OSM-only:  ${osmOnlySaved}`)
}

main().catch(err => { console.error(err); process.exit(1) })
