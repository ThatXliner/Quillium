-- Seed data for local development
-- This file runs after migrations during `supabase db reset`
-- Per PATTERNS.md: minimal test data for manual testing

-- Note: Cannot insert directly into auth.users (managed by Supabase Auth)
-- Test users must be created via Supabase Auth API or dashboard
-- This seed creates data that will be valid once test users exist

-- Example: After creating a test user via Auth, you can insert their profile:
-- INSERT INTO public.users (id, display_name, subscription_status)
-- VALUES ('user-uuid-here', 'Test User', 'free');

-- For now, just add a comment explaining the seed approach
-- Real seed data will be added when we have auth flow (Phase 2)

-- Placeholder comment to make file valid SQL
SELECT 'Seed file ready - add test data after Phase 2 auth setup' as status;
