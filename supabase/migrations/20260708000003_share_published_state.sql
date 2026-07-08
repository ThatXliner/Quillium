-- Migration: 20260708000003_share_published_state.sql
-- Purpose: Carry the serialized CodeMirror editor state for the public share
--   page so it can render through the real read-only editor (exact annotation
--   fidelity + linked revisions / version groups). Additive: pre-migration
--   shares have NULL published_state and fall back to the flat published_annotations
--   renderer on the landing site.

ALTER TABLE public.shares
    ADD COLUMN IF NOT EXISTS published_state jsonb;

COMMENT ON COLUMN public.shares.published_state IS
    'Serialized CodeMirror state (state.toJSON with annotationField + versionGroupField, no history). Rendered by the read-only editor on the public shared page; NULL for pre-migration shares.';

-- The RPC return shape changes (new column), so drop before recreating.
DROP FUNCTION IF EXISTS public.get_public_share_by_token(text);

CREATE FUNCTION public.get_public_share_by_token(p_share_token text)
RETURNS TABLE (
    published_title text,
    preview_text text,
    published_content text,
    published_annotations jsonb,
    published_state jsonb,
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
        s.published_state,
        s.author_name,
        s.published_at
    FROM public.shares AS s
    WHERE s.share_token::text = p_share_token
      AND s.enabled = true
    LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_share_by_token(text) TO anon;
