-- ============================================================
-- FindAPillar — Enriched Church Schema
-- Run in Supabase SQL Editor or via: npx tsx scripts/migrate-schema.ts
-- ============================================================

-- Drop in FK dependency order
DROP TABLE IF EXISTS church_reviews   CASCADE;
DROP TABLE IF EXISTS church_tags      CASCADE;
DROP TABLE IF EXISTS meeting_times    CASCADE;
DROP TABLE IF EXISTS pastors          CASCADE;
DROP TABLE IF EXISTS scrape_jobs      CASCADE;
DROP TABLE IF EXISTS churches         CASCADE;

-- ── Churches (enriched) ──────────────────────────────────────
CREATE TABLE churches (
  id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  name                text        NOT NULL,
  slug                text        UNIQUE NOT NULL,
  description         text,
  street_address      text,
  city                text,
  state               text,
  zip                 text,
  lat                 numeric,
  lng                 numeric,
  website             text,
  phone               text,
  email               text,
  founded_year        integer,
  average_attendance  integer,
  size                text        CHECK (size IN ('small','medium','large')),
  cover_photo         text,
  photos              text[]      DEFAULT '{}',
  denomination_id     uuid        REFERENCES denominations(id),
  denomination_path   text[],
  service_style       text        CHECK (service_style IN ('traditional','contemporary','blended','liturgical')),
  core_beliefs        jsonb,
  -- { "facebook": "url", "instagram": "url", "youtube": "url", "twitter": "url", "tiktok": "url" }
  social_links        jsonb       DEFAULT '{}',
  -- { "0": [{"open":"09:00","close":"12:00"}], "3": [...] }  (0=Sun, 1=Mon, ... 6=Sat)
  hours               jsonb       DEFAULT '{}',
  google_place_id     text,
  google_rating       numeric(2,1),
  google_review_count integer,
  google_maps_url     text,
  enriched            boolean     DEFAULT false,
  is_verified         boolean     DEFAULT false,
  is_active           boolean     DEFAULT true,
  last_scraped_at     timestamptz,
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS churches_state_idx            ON churches(state);
CREATE INDEX IF NOT EXISTS churches_lat_lng_idx          ON churches(lat, lng);
CREATE INDEX IF NOT EXISTS churches_google_place_id_idx  ON churches(google_place_id);
CREATE INDEX IF NOT EXISTS churches_is_active_idx        ON churches(is_active);
CREATE INDEX IF NOT EXISTS churches_size_idx             ON churches(size);

-- ── Pastors ──────────────────────────────────────────────────
CREATE TABLE pastors (
  id         uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  church_id  uuid    REFERENCES churches(id) ON DELETE CASCADE,
  name       text    NOT NULL,
  title      text,
  bio        text,
  photo_url  text,
  is_primary boolean DEFAULT false,
  seminary   text
);

-- ── Meeting times ────────────────────────────────────────────
CREATE TABLE meeting_times (
  id            uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  church_id     uuid    REFERENCES churches(id) ON DELETE CASCADE,
  day_of_week   integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time    time    NOT NULL,
  end_time      time,
  service_name  text,
  location_note text
);

-- ── Church tags ──────────────────────────────────────────────
CREATE TABLE church_tags (
  id        uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  church_id uuid REFERENCES churches(id) ON DELETE CASCADE,
  tag       text NOT NULL
);

-- ── Church reviews (Google / Facebook) ──────────────────────
CREATE TABLE church_reviews (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  church_id   uuid        REFERENCES churches(id) ON DELETE CASCADE,
  author_name text,
  rating      integer     CHECK (rating BETWEEN 1 AND 5),
  text        text,
  review_date date,
  source      text        DEFAULT 'google',
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS church_reviews_church_id_idx ON church_reviews(church_id);
