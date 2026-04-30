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

REVOKE SELECT ON TABLE public.shares FROM anon;

DROP POLICY IF EXISTS "Public readonly shares are visible to anon"
    ON public.shares;

CREATE OR REPLACE FUNCTION public.get_public_share_by_token(p_share_token text)
RETURNS TABLE (
    published_title text,
    preview_text text,
    published_content text,
    published_annotations jsonb,
    author_name text,
    published_at timestamp with time zone
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        s.published_title,
        s.preview_text,
        s.published_content,
        s.published_annotations,
        s.author_name,
        s.published_at
    FROM public.shares AS s
    WHERE s.share_token::text = p_share_token
      AND s.enabled = true
    LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_share_by_token(text) TO anon;
