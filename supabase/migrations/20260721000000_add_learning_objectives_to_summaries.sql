-- 20260721000000_add_learning_objectives_to_summaries.sql
-- Migration: Add learning_objectives column to public.summaries table

ALTER TABLE public.summaries ADD COLUMN IF NOT EXISTS learning_objectives jsonb;
