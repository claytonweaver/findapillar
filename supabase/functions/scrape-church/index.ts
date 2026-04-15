/**
 * scrape-church edge function
 *
 * POST body: { url: string, job_id?: string }
 *
 * Fetches the HTML from a church website URL, strips it down to meaningful text,
 * stores the result in scrape_jobs, and returns the raw text for the caller to pass
 * to process-church.
 *
 * Designed to be called from a pg_cron job or manually.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { url, job_id } = await req.json()

    if (!url) {
      return new Response(JSON.stringify({ error: 'url is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Create or update job
    let jobId = job_id
    if (!jobId) {
      const { data: job } = await supabase
        .from('scrape_jobs')
        .insert({ url, status: 'running', started_at: new Date().toISOString() })
        .select('id')
        .single()
      jobId = job?.id
    } else {
      await supabase
        .from('scrape_jobs')
        .update({ status: 'running', started_at: new Date().toISOString() })
        .eq('id', jobId)
    }

    // Fetch the page
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FindAPillarBot/1.0; +https://findapillar.com/bot)',
      },
      signal: AbortSignal.timeout(15_000),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching ${url}`)
    }

    const html = await response.text()

    // Strip HTML to text (basic extraction)
    const text = stripHtml(html).slice(0, 50_000)

    // Save raw data
    await supabase
      .from('scrape_jobs')
      .update({ raw_html: text, status: 'scraped' })
      .eq('id', jobId)

    return new Response(
      JSON.stringify({ success: true, job_id: jobId, text_length: text.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('scrape-church error:', err)
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<(h[1-6]|p|div|section|article|li|br|tr)[^>]*>/gi, '\n')
    .replace(/<\/(h[1-6]|p|div|section|article|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim()
}
