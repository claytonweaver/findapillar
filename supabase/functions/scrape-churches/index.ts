import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk'

const VALID_SERVICE_STYLES = ['traditional', 'contemporary', 'blended', 'liturgical']
const VALID_TAGS = [
  'lgbt-affirming', 'women-pastors', 'missions-focused', 'social-justice',
  'charismatic', 'reformed', 'evangelical', 'progressive', 'conservative',
  'multi-ethnic', 'young-adults', 'families', 'seniors', 'recovery-ministry',
  'spanish-service', 'korean-service', 'chinese-service', 'deaf-ministry',
  'prison-ministry', 'food-pantry', 'counseling',
]

// ── OSM helpers (no API key required) ────────────────────────────────────────

/** Geocode a city/county string to a bounding box using Nominatim. */
async function geocodeBoundingBox(location: string): Promise<[number, number, number, number]> {
  const q = encodeURIComponent(location)
  const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`
  const res = await fetch(url, { headers: { 'User-Agent': 'FindAPillar/1.0 (church directory)' } })
  const data = await res.json()
  if (!data?.length) throw new Error(`Nominatim found no results for: ${location}`)
  const { boundingbox } = data[0]
  // boundingbox = [min_lat, max_lat, min_lon, max_lon]
  return [parseFloat(boundingbox[0]), parseFloat(boundingbox[2]), parseFloat(boundingbox[1]), parseFloat(boundingbox[3])]
}

/** Query Overpass for all places of worship within a bounding box. */
async function searchChurches(location: string): Promise<any[]> {
  const [south, west, north, east] = await geocodeBoundingBox(location)
  const bbox = `${south},${west},${north},${east}`

  const query = `
    [out:json][timeout:60];
    (
      node["amenity"="place_of_worship"]["religion"="christian"](${bbox});
      way["amenity"="place_of_worship"]["religion"="christian"](${bbox});
    );
    out center tags;
  `.trim()

  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: query,
    headers: { 'Content-Type': 'text/plain', 'User-Agent': 'FindAPillar/1.0 (church directory)' },
  })
  if (!res.ok) throw new Error(`Overpass API error: ${res.status}`)
  const data = await res.json()
  return data.elements ?? []
}

/** Normalize an Overpass element into a common shape for the rest of the pipeline. */
function normalizeOsmPlace(el: any) {
  const t = el.tags ?? {}
  const lat = el.lat ?? el.center?.lat ?? null
  const lng = el.lon ?? el.center?.lon ?? null

  // Build address parts from OSM addr:* tags
  const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ')
  const city = t['addr:city'] ?? null
  const state = t['addr:state'] ?? null
  const zip = t['addr:postcode'] ?? null

  return {
    name: t.name ?? t['name:en'] ?? 'Unknown Church',
    formatted_address: [street, city, state, zip].filter(Boolean).join(', '),
    formatted_phone_number: t.phone ?? t['contact:phone'] ?? null,
    website: t.website ?? t['contact:website'] ?? t.url ?? null,
    denomination: t.denomination ?? t.religion ?? null,
    geometry: { location: { lat, lng } },
    // Pass raw OSM tags so the LLM prompt can use them
    osm_tags: t,
  }
}

// ── Website scraper ───────────────────────────────────────────────────────────

async function scrapeWebsite(url: string): Promise<string> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ChurchDirectoryBot/1.0)' },
    })
    clearTimeout(timeout)
    if (!res.ok) return ''
    const html = await res.text()
    // Strip scripts, styles, and collapse whitespace for a leaner LLM prompt
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 12000)
  } catch {
    return ''
  }
}

// ── LLM extraction ────────────────────────────────────────────────────────────

async function extractChurchData(
  placeDetails: any,
  websiteText: string,
  location: string,
  anthropic: Anthropic,
) {
  const prompt = `You are extracting structured church data for a directory. Given the source data and website text below, return a JSON object matching the schema. Only include fields you are confident about — omit uncertain ones rather than guessing.

Source data:
- Name: ${placeDetails.name}
- Address: ${placeDetails.formatted_address}
- Phone: ${placeDetails.formatted_phone_number ?? 'unknown'}
- Website: ${placeDetails.website ?? 'none'}
- OSM denomination tag: ${placeDetails.denomination ?? 'unknown'}

Website text (truncated):
${websiteText || '(no website content available)'}

Return ONLY valid JSON with these fields (all optional except name):
{
  "name": string,
  "description": string | null,           // 1-3 sentence summary of the church
  "street_address": string | null,
  "city": string | null,
  "state": string | null,                  // 2-letter code
  "zip": string | null,
  "phone": string | null,
  "email": string | null,
  "website": string | null,
  "founded_year": number | null,
  "average_attendance": number | null,     // estimate if mentioned
  "denomination_name": string | null,      // full name e.g. "Southern Baptist Convention"
  "service_style": "traditional" | "contemporary" | "blended" | "liturgical" | null,
  "core_beliefs": {
    "statement": string,                   // short doctrinal statement if found
    "beliefs": string[]                    // array of key belief bullet points
  } | null,
  "tags": string[],                        // only from: ${VALID_TAGS.join(', ')}
  "pastors": [{ "name": string, "title": string | null, "bio": string | null, "is_primary": boolean }],
  "meeting_times": [{
    "day_of_week": number,                 // 0=Sunday, 1=Monday ... 6=Saturday
    "start_time": string,                  // "HH:MM:SS" format
    "end_time": string | null,
    "service_name": string | null
  }]
}`

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = (msg.content[0] as any).text ?? ''
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('LLM returned no JSON')
  return JSON.parse(jsonMatch[0])
}

// ── Denomination matching ─────────────────────────────────────────────────────

async function findDenominationId(name: string | null, supabase: any): Promise<{ id: string | null; path: string[] | null }> {
  if (!name) return { id: null, path: null }

  // Try exact match first, then partial
  let { data } = await supabase
    .from('denominations')
    .select('id, name, parent_id')
    .ilike('name', name)
    .limit(1)
    .single()

  if (!data) {
    const words = name.split(/\s+/).filter(w => w.length > 3)
    if (words.length === 0) return { id: null, path: null }
    const { data: partial } = await supabase
      .from('denominations')
      .select('id, name, parent_id')
      .ilike('name', `%${words[0]}%`)
      .limit(1)
      .single()
    data = partial
  }

  if (!data) return { id: null, path: null }

  // Build path by walking up parent chain
  const path: string[] = [data.name]
  let current = data
  for (let i = 0; i < 5 && current.parent_id; i++) {
    const { data: parent } = await supabase
      .from('denominations')
      .select('id, name, parent_id')
      .eq('id', current.parent_id)
      .single()
    if (!parent) break
    path.unshift(parent.name)
    current = parent
  }

  return { id: data.id, path }
}

// ── Slug generation ───────────────────────────────────────────────────────────

function toSlug(name: string, city: string): string {
  return `${name}-${city}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// ── Supabase upsert ───────────────────────────────────────────────────────────

async function upsertChurch(extracted: any, placeDetails: any, denomResult: { id: string | null; path: string[] | null }, supabase: any) {
  const lat = placeDetails.geometry?.location?.lat ?? null
  const lng = placeDetails.geometry?.location?.lng ?? null
  const slug = toSlug(extracted.name, extracted.city ?? '')

  // Validate service_style
  const serviceStyle = VALID_SERVICE_STYLES.includes(extracted.service_style)
    ? extracted.service_style
    : null

  const { data: church, error } = await supabase
    .from('churches')
    .upsert({
      name: extracted.name,
      slug,
      description: extracted.description ?? null,
      street_address: extracted.street_address ?? null,
      city: extracted.city ?? null,
      state: extracted.state ?? null,
      zip: extracted.zip ?? null,
      lat,
      lng,
      website: extracted.website ?? placeDetails.website ?? null,
      phone: extracted.phone ?? placeDetails.formatted_phone_number ?? null,
      email: extracted.email ?? null,
      founded_year: extracted.founded_year ?? null,
      average_attendance: extracted.average_attendance ?? null,
      denomination_id: denomResult.id,
      denomination_path: denomResult.path,
      service_style: serviceStyle,
      core_beliefs: extracted.core_beliefs ?? null,
      is_verified: false,
      is_active: true,
    }, { onConflict: 'slug', ignoreDuplicates: false })
    .select('id')
    .single()

  if (error) throw error

  const churchId = church.id

  // Upsert pastors
  if (extracted.pastors?.length) {
    await supabase.from('pastors').delete().eq('church_id', churchId)
    await supabase.from('pastors').insert(
      extracted.pastors.map((p: any) => ({ ...p, church_id: churchId }))
    )
  }

  // Upsert meeting times
  if (extracted.meeting_times?.length) {
    await supabase.from('meeting_times').delete().eq('church_id', churchId)
    await supabase.from('meeting_times').insert(
      extracted.meeting_times.map((m: any) => ({ ...m, church_id: churchId }))
    )
  }

  // Upsert tags
  if (extracted.tags?.length) {
    const validTags = extracted.tags.filter((t: string) => VALID_TAGS.includes(t))
    if (validTags.length) {
      await supabase.from('church_tags').delete().eq('church_id', churchId)
      await supabase.from('church_tags').insert(
        validTags.map((tag: string) => ({ church_id: churchId, tag }))
      )
    }
  }

  return churchId
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' } })
  }

  try {
    const { city, state, county } = await req.json()
    if (!city && !county) {
      return new Response(JSON.stringify({ error: 'city or county is required' }), { status: 400 })
    }

    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    if (!ANTHROPIC_API_KEY) return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }), { status: 500 })

    const location = county ? `${county} County, ${state ?? ''}` : `${city}, ${state ?? ''}`
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

    console.log(`Searching for churches in: ${location}`)
    const osmPlaces = await searchChurches(location)
    console.log(`Found ${osmPlaces.length} places via OpenStreetMap`)

    const results: any[] = []
    const errors: any[] = []

    for (const place of osmPlaces) {
      try {
        const details = normalizeOsmPlace(place)
        if (!details.name || details.name === 'Unknown Church') continue

        const websiteText = details.website ? await scrapeWebsite(details.website) : ''
        const extracted = await extractChurchData(details, websiteText, location, anthropic)
        const denomResult = await findDenominationId(extracted.denomination_name ?? details.denomination, supabase)
        const churchId = await upsertChurch(extracted, details, denomResult, supabase)

        results.push({ id: churchId, name: extracted.name, city: extracted.city })
        console.log(`✓ ${extracted.name}`)
      } catch (err: any) {
        console.error(`✗ ${place.tags?.name ?? place.id}: ${err.message}`)
        errors.push({ place: place.tags?.name ?? String(place.id), error: err.message })
      }
    }

    return new Response(
      JSON.stringify({ location, total_found: places.length, inserted: results.length, churches: results, errors }),
      { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } },
    )
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
