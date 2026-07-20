-- 20260720010000_add_content_language_to_lectures.sql
-- Migration: Add content_language column to public.lectures table

ALTER TABLE public.lectures ADD COLUMN IF NOT EXISTS content_language text DEFAULT 'it' NOT NULL;
ALTER TABLE public.lectures DROP CONSTRAINT IF EXISTS check_lectures_content_language;
ALTER TABLE public.lectures ADD CONSTRAINT check_lectures_content_language CHECK (content_language IN ('it', 'en'));
