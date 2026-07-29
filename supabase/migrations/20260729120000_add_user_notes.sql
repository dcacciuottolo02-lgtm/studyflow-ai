-- 20260729120000_add_user_notes.sql
-- Migration: Add user_notes table for student lecture notes

CREATE TABLE IF NOT EXISTS public.user_notes (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    lecture_id uuid NOT NULL REFERENCES public.lectures(id) ON DELETE CASCADE UNIQUE,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    content text DEFAULT '' NOT NULL
);

-- Trigger for auto-updating updated_at
DROP TRIGGER IF EXISTS set_updated_at_user_notes ON public.user_notes;
CREATE TRIGGER set_updated_at_user_notes
BEFORE UPDATE ON public.user_notes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enable RLS
ALTER TABLE public.user_notes ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can manage their own user_notes" ON public.user_notes;
CREATE POLICY "Users can manage their own user_notes"
ON public.user_notes
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

GRANT ALL ON public.user_notes TO authenticated;
