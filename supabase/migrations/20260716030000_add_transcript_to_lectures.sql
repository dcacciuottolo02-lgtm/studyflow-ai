-- 20260716030000_add_transcript_to_lectures.sql
-- Migration: Add transcript_text column to public.lectures table

-- =========================================================================
-- 1. ADD COLUMN
-- =========================================================================
ALTER TABLE public.lectures 
ADD COLUMN IF NOT EXISTS transcript_text text;
