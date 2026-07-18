-- 20260716020000_grant_permissions.sql
-- Migration: Grant standard table privileges to the 'authenticated' role

-- =========================================================================
-- 1. GRANT SCHEMA USAGE
-- =========================================================================
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO anon;

-- =========================================================================
-- 2. GRANT TABLE PRIVILEGES TO authenticated ROLE
-- =========================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.users TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.workspaces TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.courses TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lectures TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.resources TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.study_materials TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_jobs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.summaries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.flashcard_sets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.flashcards TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.quiz_sets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.quiz_questions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.subscriptions TO authenticated;

-- =========================================================================
-- 3. GRANT SEQUENCE PRIVILEGES
-- =========================================================================
-- Grant permissions on all sequences (used for auto-incrementing/serial IDs)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
