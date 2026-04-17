-- Migration: 20260416000001_enable_extensions.sql
-- Purpose: Enable required Postgres extensions for Quillium Omni
-- Source: RESEARCH.md Pattern 4

-- Enable uuid-ossp for UUID generation (may already be enabled by Supabase)
create extension if not exists "uuid-ossp";

-- Enable moddatetime for automatic updated_at timestamp management
-- Per RESEARCH.md: "Database handles it atomically, no client coordination"
create extension if not exists moddatetime schema extensions;
