-- 20260720000000_add_ui_language_to_users.sql
-- Migration: Add ui_language column to public.users table

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS ui_language text DEFAULT 'it' NOT NULL;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS check_users_ui_language;
ALTER TABLE public.users ADD CONSTRAINT check_users_ui_language CHECK (ui_language IN ('it', 'en'));
