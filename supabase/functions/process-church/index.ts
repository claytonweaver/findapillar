/**
 * process-church edge function
 *
 * POST body: { job_id: string, church_id?: string }
 *
 * Reads scraped HTML text from scrape_jobs, sends it to Claude to extract
 * structured church data, then upserts the church record in the database.
 *
 * Requires ANTHROPIC_API_KEY to be set in Supabase secrets.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.24.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const EXTRACTION_PROMPT = `You are a church data extraction assistant. Given the text content from a church website, extract structured information about the church and return it as a JSON object.

Extract the following fields (use null if not found):
- name: string
- description: string
- street_address: string
- city: string
- state: string (2-letter code)
- zip: string
- lat: number | null
- lng: number | null
- website: string
- phone: string
- email: string
- founded_year: number | null
- average_attendance: number | null
- denomination_path: string[]
- service_style: "traditional" | "contemporary" | "blended" | "liturgical" | null
- core_beliefs: { statement: string, beliefs: string[] } | null
- pastors: Array<{ name: string, title: string, bio: string | null, is_primary: boolean }>
- meeting_times: Array<{ day_of_week: number (0=Sun), start_time: "HH:MM", service_name: string | null }>
- tags: string[]

IMPORTANT: Return ONLY valid JSON, no markdown, no explanation.`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { job_id, church_id } = await req.json()

    if (!job_id) {
      return new Response(JSON.stringify({ error: 'job_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: job, error: jobError } = await supabase
      .from('scrape_jobs')
      .select('*')
      .eq('id', job_id)
      .single()

    if (jobError || !job) {
      throw new Error(`Job ${job_id} not found`)
    }

    if (!job.raw_html) {
      throw new Error('No scraped text found. Run scrape-church first.')
    }

    await supabase.from('scrape_jobs').update({ status: 'processing' }).eq('id', job_id)

    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })

    const message = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: `${EXTRACTION_PROMPT}\n\n--- WEBSITE TEXT ---\n${job.raw_html.slice(0, 30_000)}`,
        },
      ],
    })

    const rawText = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
    // Strip markdown code fences if present (```json ... ``` or ``` ... ```)
    const rawJson = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

    let extracted: Record<string, unknown>
    try {
      extracted = JSON.parse(rawJson)
    } catch {
      throw new Error(`Claude returned invalid JSON: ${rawJson.slice(0, 200)}`)
    }

    await supabase.from('scrape_jobs').update({
      processed_data: extracted,
      status: 'completed',
      completed_at: new Date().toISOString(),
    }).eq('id', job_id)

    const churchData = {
      name: extracted.name as string,
      description: extracted.description as string | null,
      street_address: extracted.street_address as string | null,
      city: extracted.city as string | null,
      state: extracted.state as string | null,
      zip: extracted.zip as string | null,
      lat: extracted.lat as number | null,
      lng: extracted.lng as number | null,
      website: job.url,
      phone: extracted.phone as string | null,
      email: extracted.email as string | null,
      founded_year: extracted.founded_year as number | null,
      average_attendance: extracted.average_attendance as number | null,
      denomination_path: extracted.denomination_path as string[] | null,
      service_style: extracted.service_style as string | null,
      core_beliefs: extracted.core_beliefs as object | null,
      source_url: job.url,
      last_scraped_at: new Date().toISOString(),
    }

    let targetChurchId = church_id ?? job.church_id

    if (targetChurchId) {
      await supabase.from('churches').update(churchData).eq('id', targetChurchId)
    } else {
      const slug = (extracted.name as string)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')

      const { data: newChurch } = await supabase
        .from('churches')
        .insert({ ...churchData, slug })
        .select('id')
        .single()

      targetChurchId = newChurch?.id
    }

    if (targetChurchId && Array.isArray(extracted.pastors)) {
      await supabase.from('pastors').delete().eq('church_id', targetChurchId)
      if (extracted.pastors.length > 0) {
        await supabase.from('pastors').insert(
          (extracted.pastors as Array<{ name: string; title: string; bio: string | null; is_primary: boolean }>)
            .map((p) => ({ ...p, church_id: targetChurchId! }))
        )
      }
    }

    if (targetChurchId && Array.isArray(extracted.meeting_times)) {
      await supabase.from('meeting_times').delete().eq('church_id', targetChurchId)
      if (extracted.meeting_times.length > 0) {
        await supabase.from('meeting_times').insert(
          (extracted.meeting_times as Array<{ day_of_week: number; start_time: string; service_name: string | null }>)
            .map((m) => ({ ...m, church_id: targetChurchId! }))
        )
      }
    }

    if (targetChurchId && Array.isArray(extracted.tags)) {
      await supabase.from('church_tags').delete().eq('church_id', targetChurchId)
      if (extracted.tags.length > 0) {
        await supabase.from('church_tags').insert(
          (extracted.tags as string[]).map((tag) => ({ church_id: targetChurchId!, tag }))
        )
      }
    }

    await supabase.from('scrape_jobs').update({ church_id: targetChurchId }).eq('id', job_id)

    return new Response(
      JSON.stringify({ success: true, church_id: targetChurchId }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('process-church error:', err)
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
