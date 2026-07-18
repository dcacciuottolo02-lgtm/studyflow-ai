-- 20260716000000_schema_init.sql
-- Migration: Complete Database Schema for StudyFlow AI
-- Target Database: Supabase PostgreSQL (public schema)

-- =========================================================================
-- 0. INITIAL SETUP & EXTENSIONS
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Helper function to automatically update updated_at timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =========================================================================
-- 1. TABLE CREATIONS
-- =========================================================================

-- 1.1 users (extends auth.users)
CREATE TABLE public.users (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    deleted_at timestamptz,
    name text NOT NULL,
    university text,
    avatar_url text,
    plan text DEFAULT 'free' NOT NULL,
    CONSTRAINT check_users_plan CHECK (plan IN ('free', 'pro'))
);

-- 1.2 workspaces
CREATE TABLE public.workspaces (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    deleted_at timestamptz,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE UNIQUE,
    name text DEFAULT 'My Workspace' NOT NULL
);

-- 1.3 courses
CREATE TABLE public.courses (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    deleted_at timestamptz,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    name text NOT NULL,
    professor text,
    color text,
    status text DEFAULT 'active' NOT NULL,
    CONSTRAINT check_courses_status CHECK (status IN ('draft', 'active', 'archived', 'deleted'))
);

-- 1.4 lectures
CREATE TABLE public.lectures (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    deleted_at timestamptz,
    course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
    title text,
    recorded_at timestamptz,
    duration_seconds integer,
    status text DEFAULT 'created' NOT NULL,
    CONSTRAINT check_lectures_status CHECK (status IN ('created', 'recording', 'uploading', 'uploaded', 'queued', 'processing', 'completed', 'failed', 'archived', 'deleted'))
);

-- 1.5 resources
CREATE TABLE public.resources (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    lecture_id uuid NOT NULL REFERENCES public.lectures(id) ON DELETE CASCADE,
    type text NOT NULL,
    file_url text NOT NULL,
    file_size_bytes bigint,
    status text DEFAULT 'uploading' NOT NULL,
    CONSTRAINT check_resources_type CHECK (type IN ('audio', 'pdf', 'image', 'slide')),
    CONSTRAINT check_resources_status CHECK (status IN ('uploading', 'uploaded', 'processing_ocr', 'ready', 'deleted'))
);

-- 1.6 study_materials
CREATE TABLE public.study_materials (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    lecture_id uuid NOT NULL REFERENCES public.lectures(id) ON DELETE CASCADE UNIQUE,
    status text DEFAULT 'pending' NOT NULL,
    CONSTRAINT check_study_materials_status CHECK (status IN ('pending', 'partial', 'ready', 'failed'))
);

-- 1.7 ai_jobs
CREATE TABLE public.ai_jobs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    lecture_id uuid NOT NULL REFERENCES public.lectures(id) ON DELETE CASCADE,
    job_type text NOT NULL,
    status text DEFAULT 'created' NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    error_message text,
    started_at timestamptz,
    completed_at timestamptz,
    CONSTRAINT check_ai_jobs_job_type CHECK (job_type IN ('transcription', 'summary', 'flashcards', 'quiz', 'embeddings')),
    CONSTRAINT check_ai_jobs_status CHECK (status IN ('created', 'queued', 'running', 'completed', 'failed', 'retrying'))
);

-- 1.8 summaries
CREATE TABLE public.summaries (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    study_material_id uuid NOT NULL REFERENCES public.study_materials(id) ON DELETE CASCADE UNIQUE,
    content text NOT NULL,
    key_concepts jsonb,
    version integer DEFAULT 1 NOT NULL
);

-- 1.9 flashcard_sets
CREATE TABLE public.flashcard_sets (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    study_material_id uuid NOT NULL REFERENCES public.study_materials(id) ON DELETE CASCADE,
    version integer DEFAULT 1 NOT NULL
);

-- 1.10 flashcards
CREATE TABLE public.flashcards (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    flashcard_set_id uuid NOT NULL REFERENCES public.flashcard_sets(id) ON DELETE CASCADE,
    question text NOT NULL,
    answer text NOT NULL,
    status text DEFAULT 'unseen' NOT NULL,
    order_index integer DEFAULT 0 NOT NULL,
    CONSTRAINT check_flashcards_status CHECK (status IN ('unseen', 'known', 'unknown'))
);

-- 1.11 quiz_sets
CREATE TABLE public.quiz_sets (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    study_material_id uuid NOT NULL REFERENCES public.study_materials(id) ON DELETE CASCADE,
    version integer DEFAULT 1 NOT NULL
);

-- 1.12 quiz_questions
CREATE TABLE public.quiz_questions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    quiz_set_id uuid NOT NULL REFERENCES public.quiz_sets(id) ON DELETE CASCADE,
    question text NOT NULL,
    options jsonb NOT NULL,
    correct_option_index integer NOT NULL,
    order_index integer DEFAULT 0 NOT NULL
);

-- 1.13 ai_sessions
CREATE TABLE public.ai_sessions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    lecture_id uuid NOT NULL REFERENCES public.lectures(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    status text DEFAULT 'active' NOT NULL,
    CONSTRAINT check_ai_sessions_status CHECK (status IN ('created', 'active', 'inactive', 'archived'))
);

-- 1.14 ai_messages
CREATE TABLE public.ai_messages (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    session_id uuid NOT NULL REFERENCES public.ai_sessions(id) ON DELETE CASCADE,
    role text NOT NULL,
    content text NOT NULL,
    CONSTRAINT check_ai_messages_role CHECK (role IN ('user', 'assistant'))
);

-- 1.15 subscriptions
CREATE TABLE public.subscriptions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE UNIQUE,
    plan text DEFAULT 'free' NOT NULL,
    status text DEFAULT 'active' NOT NULL,
    stripe_customer_id text,
    stripe_subscription_id text,
    current_period_end timestamptz,
    CONSTRAINT check_subscriptions_plan CHECK (plan IN ('free', 'pro')),
    CONSTRAINT check_subscriptions_status CHECK (status IN ('trial', 'active', 'cancelled', 'expired'))
);

-- =========================================================================
-- 2. INDEX CREATIONS FOR FOREIGN KEYS
-- =========================================================================

-- Note: UNIQUE constraints automatically generate indexes in PostgreSQL.
-- We manually create indexes for foreign keys that are highly queried.

CREATE INDEX idx_courses_workspace_id ON public.courses(workspace_id);
CREATE INDEX idx_lectures_course_id ON public.lectures(course_id);
CREATE INDEX idx_resources_lecture_id ON public.resources(lecture_id);
CREATE INDEX idx_ai_jobs_lecture_id ON public.ai_jobs(lecture_id);
CREATE INDEX idx_flashcard_sets_study_material_id ON public.flashcard_sets(study_material_id);
CREATE INDEX idx_flashcards_flashcard_set_id ON public.flashcards(flashcard_set_id);
CREATE INDEX idx_quiz_sets_study_material_id ON public.quiz_sets(study_material_id);
CREATE INDEX idx_quiz_questions_quiz_set_id ON public.quiz_questions(quiz_set_id);
CREATE INDEX idx_ai_sessions_lecture_id ON public.ai_sessions(lecture_id);
CREATE INDEX idx_ai_sessions_user_id ON public.ai_sessions(user_id);
CREATE INDEX idx_ai_messages_session_id ON public.ai_messages(session_id);

-- =========================================================================
-- 3. UPDATED_AT TRIGGERS (Automated Timestamps)
-- =========================================================================

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_workspaces_updated_at BEFORE UPDATE ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_courses_updated_at BEFORE UPDATE ON public.courses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_lectures_updated_at BEFORE UPDATE ON public.lectures FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_resources_updated_at BEFORE UPDATE ON public.resources FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_study_materials_updated_at BEFORE UPDATE ON public.study_materials FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_ai_jobs_updated_at BEFORE UPDATE ON public.ai_jobs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_summaries_updated_at BEFORE UPDATE ON public.summaries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_flashcard_sets_updated_at BEFORE UPDATE ON public.flashcard_sets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_flashcards_updated_at BEFORE UPDATE ON public.flashcards FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_quiz_sets_updated_at BEFORE UPDATE ON public.quiz_sets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_quiz_questions_updated_at BEFORE UPDATE ON public.quiz_questions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_ai_sessions_updated_at BEFORE UPDATE ON public.ai_sessions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_ai_messages_updated_at BEFORE UPDATE ON public.ai_messages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================================
-- 4. BUSINESS LOGIC TRIGGERS & FUNCTIONS
-- =========================================================================

-- 4.1 Signup Trigger: Handles user profile creation, workspace, and free subscription
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    default_name text;
    new_workspace_id uuid;
BEGIN
    -- Extract name from metadata or fallback to email prefix/default
    default_name := COALESCE(
        new.raw_user_meta_data->>'name',
        new.raw_user_meta_data->>'full_name',
        split_part(new.email, '@', 1),
        'Student'
    );

    -- 1. Create public.users entry
    INSERT INTO public.users (id, name, avatar_url, plan)
    VALUES (
        new.id,
        default_name,
        new.raw_user_meta_data->>'avatar_url',
        'free'
    );

    -- 2. Create the unique default workspace
    INSERT INTO public.workspaces (user_id, name)
    VALUES (new.id, 'My Workspace')
    RETURNING id INTO new_workspace_id;

    -- 3. Create the default 'free' subscription
    INSERT INTO public.subscriptions (user_id, plan, status)
    VALUES (new.id, 'free', 'active');

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger attached to auth.users
CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4.2 Subscription Sync Trigger: Syncs subscriptions.plan -> users.plan
CREATE OR REPLACE FUNCTION public.sync_user_plan()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.users
    SET plan = NEW.plan
    WHERE id = NEW.user_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger attached to public.subscriptions
CREATE OR REPLACE TRIGGER on_subscription_change
    AFTER INSERT OR UPDATE ON public.subscriptions
    FOR EACH ROW EXECUTE FUNCTION public.sync_user_plan();

-- =========================================================================
-- 5. ROW LEVEL SECURITY (RLS) POLICIES
-- =========================================================================

-- Enable RLS for all 15 tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lectures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flashcard_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flashcards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- 5.1 users policies
CREATE POLICY "Users can manage their own user record"
    ON public.users FOR ALL
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

-- 5.2 workspaces policies
CREATE POLICY "Users can manage their own workspaces"
    ON public.workspaces FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- 5.3 subscriptions policies
CREATE POLICY "Users can manage their own subscriptions"
    ON public.subscriptions FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- 5.4 courses policies
CREATE POLICY "Users can manage courses in their workspaces"
    ON public.courses FOR ALL
    USING (
        workspace_id IN (
            SELECT w.id FROM public.workspaces w WHERE w.user_id = auth.uid()
        )
    )
    WITH CHECK (
        workspace_id IN (
            SELECT w.id FROM public.workspaces w WHERE w.user_id = auth.uid()
        )
    );

-- 5.5 lectures policies
CREATE POLICY "Users can manage lectures in their courses"
    ON public.lectures FOR ALL
    USING (
        course_id IN (
            SELECT c.id FROM public.courses c
            JOIN public.workspaces w ON c.workspace_id = w.id
            WHERE w.user_id = auth.uid()
        )
    )
    WITH CHECK (
        course_id IN (
            SELECT c.id FROM public.courses c
            JOIN public.workspaces w ON c.workspace_id = w.id
            WHERE w.user_id = auth.uid()
        )
    );

-- 5.6 resources policies
CREATE POLICY "Users can manage resources in their lectures"
    ON public.resources FOR ALL
    USING (
        lecture_id IN (
            SELECT l.id FROM public.lectures l
            JOIN public.courses c ON l.course_id = c.id
            JOIN public.workspaces w ON c.workspace_id = w.id
            WHERE w.user_id = auth.uid()
        )
    )
    WITH CHECK (
        lecture_id IN (
            SELECT l.id FROM public.lectures l
            JOIN public.courses c ON l.course_id = c.id
            JOIN public.workspaces w ON c.workspace_id = w.id
            WHERE w.user_id = auth.uid()
        )
    );

-- 5.7 study_materials policies
CREATE POLICY "Users can manage study materials in their lectures"
    ON public.study_materials FOR ALL
    USING (
        lecture_id IN (
            SELECT l.id FROM public.lectures l
            JOIN public.courses c ON l.course_id = c.id
            JOIN public.workspaces w ON c.workspace_id = w.id
            WHERE w.user_id = auth.uid()
        )
    )
    WITH CHECK (
        lecture_id IN (
            SELECT l.id FROM public.lectures l
            JOIN public.courses c ON l.course_id = c.id
            JOIN public.workspaces w ON c.workspace_id = w.id
            WHERE w.user_id = auth.uid()
        )
    );

-- 5.8 ai_jobs policies
CREATE POLICY "Users can manage AI jobs in their lectures"
    ON public.ai_jobs FOR ALL
    USING (
        lecture_id IN (
            SELECT l.id FROM public.lectures l
            JOIN public.courses c ON l.course_id = c.id
            JOIN public.workspaces w ON c.workspace_id = w.id
            WHERE w.user_id = auth.uid()
        )
    )
    WITH CHECK (
        lecture_id IN (
            SELECT l.id FROM public.lectures l
            JOIN public.courses c ON l.course_id = c.id
            JOIN public.workspaces w ON c.workspace_id = w.id
            WHERE w.user_id = auth.uid()
        )
    );

-- 5.9 summaries policies
CREATE POLICY "Users can manage summaries in their study materials"
    ON public.summaries FOR ALL
    USING (
        study_material_id IN (
            SELECT sm.id FROM public.study_materials sm
            JOIN public.lectures l ON sm.lecture_id = l.id
            JOIN public.courses c ON l.course_id = c.id
            JOIN public.workspaces w ON c.workspace_id = w.id
            WHERE w.user_id = auth.uid()
        )
    )
    WITH CHECK (
        study_material_id IN (
            SELECT sm.id FROM public.study_materials sm
            JOIN public.lectures l ON sm.lecture_id = l.id
            JOIN public.courses c ON l.course_id = c.id
            JOIN public.workspaces w ON c.workspace_id = w.id
            WHERE w.user_id = auth.uid()
        )
    );

-- 5.10 flashcard_sets policies
CREATE POLICY "Users can manage flashcard sets in their study materials"
    ON public.flashcard_sets FOR ALL
    USING (
        study_material_id IN (
            SELECT sm.id FROM public.study_materials sm
            JOIN public.lectures l ON sm.lecture_id = l.id
            JOIN public.courses c ON l.course_id = c.id
            JOIN public.workspaces w ON c.workspace_id = w.id
            WHERE w.user_id = auth.uid()
        )
    )
    WITH CHECK (
        study_material_id IN (
            SELECT sm.id FROM public.study_materials sm
            JOIN public.lectures l ON sm.lecture_id = l.id
            JOIN public.courses c ON l.course_id = c.id
            JOIN public.workspaces w ON c.workspace_id = w.id
            WHERE w.user_id = auth.uid()
        )
    );

-- 5.11 flashcards policies
CREATE POLICY "Users can manage flashcards in their flashcard sets"
    ON public.flashcards FOR ALL
    USING (
        flashcard_set_id IN (
            SELECT fs.id FROM public.flashcard_sets fs
            JOIN public.study_materials sm ON fs.study_material_id = sm.id
            JOIN public.lectures l ON sm.lecture_id = l.id
            JOIN public.courses c ON l.course_id = c.id
            JOIN public.workspaces w ON c.workspace_id = w.id
            WHERE w.user_id = auth.uid()
        )
    )
    WITH CHECK (
        flashcard_set_id IN (
            SELECT fs.id FROM public.flashcard_sets fs
            JOIN public.study_materials sm ON fs.study_material_id = sm.id
            JOIN public.lectures l ON sm.lecture_id = l.id
            JOIN public.courses c ON l.course_id = c.id
            JOIN public.workspaces w ON c.workspace_id = w.id
            WHERE w.user_id = auth.uid()
        )
    );

-- 5.12 quiz_sets policies
CREATE POLICY "Users can manage quiz sets in their study materials"
    ON public.quiz_sets FOR ALL
    USING (
        study_material_id IN (
            SELECT sm.id FROM public.study_materials sm
            JOIN public.lectures l ON sm.lecture_id = l.id
            JOIN public.courses c ON l.course_id = c.id
            JOIN public.workspaces w ON c.workspace_id = w.id
            WHERE w.user_id = auth.uid()
        )
    )
    WITH CHECK (
        study_material_id IN (
            SELECT sm.id FROM public.study_materials sm
            JOIN public.lectures l ON sm.lecture_id = l.id
            JOIN public.courses c ON l.course_id = c.id
            JOIN public.workspaces w ON c.workspace_id = w.id
            WHERE w.user_id = auth.uid()
        )
    );

-- 5.13 quiz_questions policies
CREATE POLICY "Users can manage quiz questions in their quiz sets"
    ON public.quiz_questions FOR ALL
    USING (
        quiz_set_id IN (
            SELECT qs.id FROM public.quiz_sets qs
            JOIN public.study_materials sm ON qs.study_material_id = sm.id
            JOIN public.lectures l ON sm.lecture_id = l.id
            JOIN public.courses c ON l.course_id = c.id
            JOIN public.workspaces w ON c.workspace_id = w.id
            WHERE w.user_id = auth.uid()
        )
    )
    WITH CHECK (
        quiz_set_id IN (
            SELECT qs.id FROM public.quiz_sets qs
            JOIN public.study_materials sm ON qs.study_material_id = sm.id
            JOIN public.lectures l ON sm.lecture_id = l.id
            JOIN public.courses c ON l.course_id = c.id
            JOIN public.workspaces w ON c.workspace_id = w.id
            WHERE w.user_id = auth.uid()
        )
    );

-- 5.14 ai_sessions policies
CREATE POLICY "Users can manage their own AI sessions"
    ON public.ai_sessions FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- 5.15 ai_messages policies
CREATE POLICY "Users can manage AI messages in their sessions"
    ON public.ai_messages FOR ALL
    USING (
        session_id IN (
            SELECT id FROM public.ai_sessions WHERE user_id = auth.uid()
        )
    )
    WITH CHECK (
        session_id IN (
            SELECT id FROM public.ai_sessions WHERE user_id = auth.uid()
        )
    );
