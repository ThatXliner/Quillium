-- Migration: 20260423000002_public_readonly_shares.sql
-- Purpose: Store the published read-only snapshot for public share pages.

ALTER TABLE public.shares
    ADD COLUMN IF NOT EXISTS published_title text NOT NULL DEFAULT 'Untitled',
    ADD COLUMN IF NOT EXISTS preview_text text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS published_content text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS published_annotations jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS author_name text,
    ADD COLUMN IF NOT EXISTS published_at timestamp with time zone;

COMMENT ON COLUMN public.shares.published_title IS
    'Title shown on the public read-only shared page.';

COMMENT ON COLUMN public.shares.preview_text IS
    'Short excerpt used for previews and metadata on the public shared page.';

COMMENT ON COLUMN public.shares.published_content IS
    'Snapshot of the published plain-text document body.';

COMMENT ON COLUMN public.shares.published_annotations IS
    'Serialized annotations rendered on the public shared page.';

COMMENT ON COLUMN public.shares.author_name IS
    'Author name shown on the public shared page.';

COMMENT ON COLUMN public.shares.published_at IS
    'When the current public snapshot was last explicitly published from the app.';

GRANT SELECT ON TABLE public.shares TO anon;

CREATE POLICY "Public readonly shares are visible to anon"
    ON public.shares
    FOR SELECT
    TO anon
    USING (enabled = true);
