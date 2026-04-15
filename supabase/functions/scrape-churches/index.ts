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

// ── Google Places helpers ─────────────────────────────────────────────────────

async function searchChurches(location: string, apiKey: string) {
  const query = encodeURIComponent(`churches in ${location}`)
  const places: any[] = []
  let pageToken: string | undefined

  do {
    const url = pageToken
      ? `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${pageToken}&key=${apiKey}`
      : `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&type=church&key=${apiKey}`

    const res = await fetch(url)
    const data = await res.json()

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      throw new Error(`Places API error: ${data.status} — ${data.error_message ?? ''}`)
    }

    places.push(...(data.results ?? []))
    pageToken = data.next_page_token

    // Google requires a short delay before using next_page_token
    if (pageToken) await new Promise(r => setTimeout(r, 2000))
  } while (pageToken && places.length < 60)

  return places
}

async function getPlaceDetails(placeId: string, apiKey: string) {
  const fields = 'name,formatted_address,formatted_phone_number,website,geometry,types,url'
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${fields}&key=${apiKey}`
  const res = await fetch(url)
  const data = await res.json()
  if (data.status !== 'OK') return null
  return data.result
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
  const addressParts = (placeDetails.formatted_address ?? '').split(',').map((s: string) => s.trim())

  const prompt = `You are extracting structured church data for a directory. Given the Google Places info and website text below, return a JSON object matching the schema. Only include fields you are confident about — omit uncertain ones rather than guessing.

Google Places data:
- Name: ${placeDetails.name}
- Address: ${placeDetails.formatted_address}
- Phone: ${placeDetails.formatted_phone_number ?? 'unknown'}
- Website: ${placeDetails.website ?? 'none'}

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

    const GOOGLE_API_KEY = Deno.env.get('GOOGLE_PLACES_API_KEY')
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    if (!GOOGLE_API_KEY) return new Response(JSON.stringify({ error: 'GOOGLE_PLACES_API_KEY not set' }), { status: 500 })
    if (!ANTHROPIC_API_KEY) return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }), { status: 500 })

    const location = county ? `${county} County, ${state ?? ''}` : `${city}, ${state ?? ''}`
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

    console.log(`Searching for churches in: ${location}`)
    const places = await searchChurches(location, GOOGLE_API_KEY)
    console.log(`Found ${places.length} places`)

    const results: any[] = []
    const errors: any[] = []

    for (const place of places) {
      try {
        const details = await getPlaceDetails(place.place_id, GOOGLE_API_KEY)
        if (!details) continue

        const websiteText = details.website ? await scrapeWebsite(details.website) : ''
        const extracted = await extractChurchData(details, websiteText, location, anthropic)
        const denomResult = await findDenominationId(extracted.denomination_name, supabase)
        const churchId = await upsertChurch(extracted, details, denomResult, supabase)

        results.push({ id: churchId, name: extracted.name, city: extracted.city })
        console.log(`✓ ${extracted.name}`)
      } catch (err: any) {
        console.error(`✗ ${place.name}: ${err.message}`)
        errors.push({ place: place.name, error: err.message })
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
