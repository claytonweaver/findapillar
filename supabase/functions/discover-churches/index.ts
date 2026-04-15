/**
 * discover-churches edge function
 *
 * POST body: { city?: string, county?: string, state?: string }
 *
 * Uses OpenStreetMap (no API key needed) to find all churches in the given
 * city or county, then fans out to scrape-church + process-church for each
 * one that has a website URL.
 *
 * Returns a summary of queued jobs.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── OSM discovery ─────────────────────────────────────────────────────────────

async function geocodeBoundingBox(location: string): Promise<[number, number, number, number]> {
  const q = encodeURIComponent(location)
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`,
    { headers: { 'User-Agent': 'FindAPillar/1.0 (church directory)' } }
  )
  const data = await res.json()
  if (!data?.length) throw new Error(`No geocoding results for: ${location}`)
  const bb = data[0].boundingbox
  // boundingbox = [min_lat, max_lat, min_lon, max_lon]
  return [parseFloat(bb[0]), parseFloat(bb[2]), parseFloat(bb[1]), parseFloat(bb[3])]
}

async function findChurchesInArea(location: string) {
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
  return (data.elements ?? []) as any[]
}

function extractWebsite(tags: Record<string, string>): string | null {
  const raw = tags['website'] ?? tags['contact:website'] ?? tags['url'] ?? null
  if (!raw) return null
  return raw.startsWith('http') ? raw : `https://${raw}`
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { city, county, state } = await req.json()
    if (!city && !county) {
      return new Response(
        JSON.stringify({ error: 'city or county is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    const location = county
      ? `${county} County, ${state ?? ''}`
      : `${city}, ${state ?? ''}`

    console.log(`Discovering churches in: ${location}`)
    const places = await findChurchesInArea(location)
    console.log(`OSM returned ${places.length} places`)

    const queued: { name: string; url: string; job_id: string }[] = []
    const skipped: { name: string; reason: string }[] = []

    for (const place of places) {
      const tags = place.tags ?? {}
      const name = tags['name'] ?? tags['name:en'] ?? null
      if (!name) { skipped.push({ name: 'unnamed', reason: 'no name in OSM' }); continue }

      const website = extractWebsite(tags)
      if (!website) { skipped.push({ name, reason: 'no website in OSM' }); continue }

      // Call scrape-church, which creates the scrape_job and fetches the HTML
      const scrapeRes = await fetch(`${SUPABASE_URL}/functions/v1/scrape-church`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ url: website }),
      })

      const scrapeData = await scrapeRes.json()
      if (!scrapeRes.ok || scrapeData.error) {
        skipped.push({ name, reason: scrapeData.error ?? `HTTP ${scrapeRes.status}` })
        continue
      }

      const jobId = scrapeData.job_id

      // Call process-church to extract structured data and upsert
      const processRes = await fetch(`${SUPABASE_URL}/functions/v1/process-church`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ job_id: jobId }),
      })

      const processData = await processRes.json()
      if (!processRes.ok || processData.error) {
        skipped.push({ name, reason: processData.error ?? `HTTP ${processRes.status}` })
        continue
      }

      queued.push({ name, url: website, job_id: jobId })
      console.log(`✓ ${name}`)
    }

    return new Response(
      JSON.stringify({
        location,
        total_found: places.length,
        processed: queued.length,
        skipped: skipped.length,
        churches: queued,
        skipped_details: skipped,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('discover-churches error:', err)
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
