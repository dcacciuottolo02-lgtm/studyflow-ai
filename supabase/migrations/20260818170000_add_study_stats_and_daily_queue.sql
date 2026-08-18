-- 20260818170000_add_study_stats_and_daily_queue.sql
-- Migration: Add user_study_stats table for daily streak and academic progress tracking

CREATE TABLE IF NOT EXISTS public.user_study_stats (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE UNIQUE,
    current_streak integer DEFAULT 1 NOT NULL,
    longest_streak integer DEFAULT 1 NOT NULL,
    last_study_date date DEFAULT CURRENT_DATE NOT NULL,
    daily_goal_target integer DEFAULT 3 NOT NULL,
    completed_today_count integer DEFAULT 0 NOT NULL,
    total_flashcards_reviewed integer DEFAULT 0 NOT NULL,
    total_quizzes_completed integer DEFAULT 0 NOT NULL,
    total_study_minutes integer DEFAULT 0 NOT NULL
);

-- Trigger for auto-updating updated_at
DROP TRIGGER IF EXISTS set_updated_at_user_study_stats ON public.user_study_stats;
CREATE TRIGGER set_updated_at_user_study_stats
BEFORE UPDATE ON public.user_study_stats
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enable RLS
ALTER TABLE public.user_study_stats ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can manage their own study stats" ON public.user_study_stats;
CREATE POLICY "Users can manage their own study stats"
ON public.user_study_stats
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

GRANT ALL ON public.user_study_stats TO authenticated;
