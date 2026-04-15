/**
 * discover-churches edge function
 *
 * POST body: { city?: string, county?: string, state?: string, limit?: number }
 *
 * 1. Uses OpenStreetMap (no API key) to find churches in the area
 * 2. Saves all churches — website or not
 * 3. For churches with websites: scrapes + Claude extracts full details
 * 4. For churches without websites: saves basic OSM data directly
 * 5. Upserts everything into Supabase
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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
  const data = await res.json()
  if (!data?.length) throw new Error(`No geocoding results for: ${location}`)
  const hit = data[0]
  if (hit.osm_type === 'relation') return 3_600_000_000 + parseInt(hit.osm_id)
  if (hit.osm_type === 'way') return 2_400_000_000 + parseInt(hit.osm_id)
  throw new Error(`Cannot resolve OSM area for: ${location} (type: ${hit.osm_type})`)
}

async function findChurchesInArea(location: string): Promise<any[]> {
  const areaId = await getOsmAreaId(location)
  const query = `
    [out:json][timeout:55][maxsize:20000000];
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
    if (res.ok) return (await res.json()).elements ?? []
    console.warn(`Overpass ${endpoint} returned ${res.status}`)
  }
  throw new Error('All Overpass endpoints failed')
}

function getWebsite(tags: Record<string, string>): string | null {
  const raw = tags['website'] ?? tags['contact:website'] ?? tags['url'] ?? null
  if (!raw) return null
  return raw.startsWith('http') ? raw : `https://${raw}`
}

// ── Scraper ───────────────────────────────────────────────────────────────────

interface ScrapeResult {
  text: string
  coverPhoto: string | null
}

async function scrapeWebsite(url: string): Promise<ScrapeResult> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(12_000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FindAPillarBot/1.0)' },
    })
    if (!res.ok) return { text: '', coverPhoto: null }
    const html = await res.text()

    // Extract og:image / twitter:image before stripping tags
    const ogImage =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1] ??
      html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i)?.[1] ??
      null

    // Resolve relative URLs
    let coverPhoto: string | null = null
    if (ogImage) {
      try {
        coverPhoto = new URL(ogImage, url).href
      } catch {
        coverPhoto = ogImage.startsWith('http') ? ogImage : null
      }
    }

    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<head[\s\S]*?<\/head>/gi, '')
      .replace(/<(h[1-6]|p|div|section|article|li|br|tr)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, 25_000)

    return { text, coverPhoto }
  } catch {
    return { text: '', coverPhoto: null }
  }
}

// ── LLM extraction ────────────────────────────────────────────────────────────

async function extractChurchData(
  name: string, address: string, phone: string | null,
  website: string, osmDenomination: string | null,
  websiteText: string, anthropic: Anthropic
) {
  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 3000,
    messages: [{
      role: 'user',
      content: `You are extracting church directory data. Be thorough — look carefully through the entire text for every piece of information. Return ONLY valid JSON, no markdown fences.

Source info:
- Name: ${name}
- Address: ${address}
- Phone: ${phone ?? 'unknown'}
- Website: ${website}
- OSM denomination tag: ${osmDenomination ?? 'unknown'}

Website text:
${websiteText || '(no website content available)'}

Extract the following (omit fields you cannot find — do NOT guess):
{
  "name": string,
  "description": string | null,          // 2-4 sentences summarizing the church's identity/mission
  "street_address": string | null,
  "city": string | null,
  "state": string | null,                 // 2-letter code
  "zip": string | null,
  "phone": string | null,
  "email": string | null,
  "founded_year": number | null,
  "average_attendance": number | null,    // Look for any mention: "congregation of X", "X members", "X people weekly", "X attend", "X families". Give a number if found.
  "denomination_name": string | null,     // Full official name e.g. "United Methodist Church", "Southern Baptist Convention"
  "service_style": "traditional"|"contemporary"|"blended"|"liturgical"|null,
  "core_beliefs": {
    "statement": string,                  // Doctrinal/mission statement if present
    "beliefs": string[]                   // Key theological positions, 3-8 bullet points
  } | null,
  "tags": string[],                       // ONLY from this list: ${VALID_TAGS.join(', ')}
  "pastors": [{
    "name": string,
    "title": string | null,               // e.g. "Senior Pastor", "Lead Pastor", "Rector"
    "bio": string | null,                 // Brief bio if available
    "is_primary": boolean
  }],
  "meeting_times": [{
    "day_of_week": number,                // 0=Sunday, 1=Monday, 6=Saturday
    "start_time": "HH:MM:SS",
    "end_time": string | null,
    "service_name": string | null         // e.g. "Traditional Service", "Contemporary Worship"
  }]
}`,
    }],
  })

  const raw = (msg.content[0] as any).text?.trim() ?? ''
  const json = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  return JSON.parse(json)
}

// ── Denomination lookup ───────────────────────────────────────────────────────

async function findDenomination(name: string | null, supabase: any) {
  if (!name) return { id: null, path: null }
  let { data } = await supabase.from('denominations').select('id, name, parent_id').ilike('name', name).limit(1).single()
  if (!data) {
    const word = name.split(/\s+/).find((w: string) => w.length > 4)
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

// ── Slug ──────────────────────────────────────────────────────────────────────

function toSlug(name: string, city: string | null): string {
  return `${name}-${city ?? ''}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// ── Upsert ────────────────────────────────────────────────────────────────────

async function upsertChurch(
  extracted: any, lat: number | null, lng: number | null,
  website: string | null, coverPhoto: string | null,
  denomResult: any, supabase: any
) {
  const serviceStyle = ['traditional', 'contemporary', 'blended', 'liturgical'].includes(extracted.service_style)
    ? extracted.service_style : null

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
      lat, lng,
      website,
      phone: extracted.phone ?? null,
      email: extracted.email ?? null,
      founded_year: extracted.founded_year ?? null,
      average_attendance: extracted.average_attendance ?? null,
      denomination_id: denomResult.id,
      denomination_path: denomResult.path,
      service_style: serviceStyle,
      cover_photo: coverPhoto,
      core_beliefs: extracted.core_beliefs ?? null,
      is_verified: false,
      is_active: true,
    }, { onConflict: 'slug' })
    .select('id').single()

  if (error) throw error

  const id = church.id
  if (extracted.pastors?.length) {
    await supabase.from('pastors').delete().eq('church_id', id)
    await supabase.from('pastors').insert(extracted.pastors.map((p: any) => ({ ...p, church_id: id })))
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

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { city, county, state, limit = 15, offset = 0 } = await req.json()
    if (!city && !county) {
      return new Response(JSON.stringify({ error: 'city or county is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })

    const location = county ? `${county} County, ${state ?? ''}` : `${city}, ${state ?? ''}`
    console.log(`Discovering churches in: ${location}`)

    const places = await findChurchesInArea(location)
    console.log(`OSM: ${places.length} total places`)

    const withWebsites = places.filter(p => getWebsite(p.tags ?? {}))
    const withoutWebsites = places.filter(p => !getWebsite(p.tags ?? {}))
    const toScrape = withWebsites.slice(offset, offset + limit)

    console.log(`${withWebsites.length} with websites (scraping ${toScrape.length}), ${withoutWebsites.length} OSM-only`)

    const scraped: any[] = []
    const osmOnly: any[] = []
    const errors: any[] = []

    // ── Churches with websites: full scrape + LLM ──
    for (const place of toScrape) {
      const tags = place.tags ?? {}
      const name = tags['name'] ?? tags['name:en'] ?? 'Unknown Church'
      try {
        const website = getWebsite(tags)!
        const lat = place.lat ?? place.center?.lat ?? null
        const lng = place.lon ?? place.center?.lon ?? null
        const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ')
        const address = [street, tags['addr:city'], tags['addr:state'], tags['addr:postcode']].filter(Boolean).join(', ') || location

        const { text, coverPhoto } = await scrapeWebsite(website)
        const extracted = await extractChurchData(
          name, address, tags['phone'] ?? tags['contact:phone'] ?? null,
          website, tags['denomination'] ?? null, text, anthropic
        )
        const denomResult = await findDenomination(
          extracted.denomination_name ?? tags['denomination'] ?? null, supabase
        )
        const churchId = await upsertChurch(extracted, lat, lng, website, coverPhoto, denomResult, supabase)

        scraped.push({ id: churchId, name: extracted.name, city: extracted.city, has_photo: !!coverPhoto, attendance: extracted.average_attendance })
        console.log(`✓ ${extracted.name}${coverPhoto ? ' [photo]' : ''}${extracted.average_attendance ? ` [att: ${extracted.average_attendance}]` : ''}`)
      } catch (err: any) {
        console.error(`✗ ${name}: ${err.message}`)
        errors.push({ name, error: err.message })
      }
    }

    // ── Churches without websites: batch upsert basic OSM data ──
    const osmRows = withoutWebsites
      .filter(p => p.tags?.name)
      .map((place: any) => {
        const tags = place.tags ?? {}
        const name = tags['name'] ?? tags['name:en']
        const city = tags['addr:city'] ?? null
        return {
          name,
          slug: toSlug(name, city),
          street_address: [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ') || null,
          city,
          state: tags['addr:state'] ?? null,
          zip: tags['addr:postcode'] ?? null,
          lat: place.lat ?? place.center?.lat ?? null,
          lng: place.lon ?? place.center?.lon ?? null,
          phone: tags['phone'] ?? tags['contact:phone'] ?? null,
          is_verified: false,
          is_active: true,
        }
      })

    let osmSaved = 0
    // Batch in chunks of 100 to stay within limits
    for (let i = 0; i < osmRows.length; i += 100) {
      const chunk = osmRows.slice(i, i + 100)
      const { error } = await supabase.from('churches').upsert(chunk, { onConflict: 'slug', ignoreDuplicates: true })
      if (!error) osmSaved += chunk.length
    }
    console.log(`Saved ${osmSaved} OSM-only churches`)

    return new Response(
      JSON.stringify({
        location,
        total_found: places.length,
        scraped: scraped.length,
        osm_only: osmSaved,
        remaining_with_websites: Math.max(0, withWebsites.length - offset - limit),
        errors: errors.length,
        churches: scraped,
        error_details: errors,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error(err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
