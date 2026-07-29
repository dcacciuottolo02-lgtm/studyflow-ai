-- 20260730000000_add_admin_dashboard.sql
-- Migration: Admin Dashboard & RLS Security Policies for StudyFlow AI

-- =========================================================================
-- 1. SCHEMA MODIFICATIONS
-- =========================================================================

-- Add is_admin flag to public.users if it doesn't already exist
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS is_admin boolean DEFAULT false NOT NULL;

-- =========================================================================
-- 2. SECURITY DEFINER HELPER FUNCTION
-- =========================================================================

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid() AND is_admin = true
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Grant execution permission
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- =========================================================================
-- 3. RLS POLICIES FOR ADMIN ACCESS
-- =========================================================================

-- 3.1 users policies
DROP POLICY IF EXISTS "Admins can select all users" ON public.users;
CREATE POLICY "Admins can select all users"
    ON public.users FOR SELECT
    USING (public.is_admin() OR id = auth.uid());

DROP POLICY IF EXISTS "Admins can update all users" ON public.users;
CREATE POLICY "Admins can update all users"
    ON public.users FOR UPDATE
    USING (public.is_admin() OR id = auth.uid());

-- 3.2 workspaces policies
DROP POLICY IF EXISTS "Admins can select all workspaces" ON public.workspaces;
CREATE POLICY "Admins can select all workspaces"
    ON public.workspaces FOR SELECT
    USING (public.is_admin() OR user_id = auth.uid());

-- 3.3 courses policies
DROP POLICY IF EXISTS "Admins can select all courses" ON public.courses;
CREATE POLICY "Admins can select all courses"
    ON public.courses FOR SELECT
    USING (
        public.is_admin() OR 
        workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid())
    );

-- 3.4 lectures policies
DROP POLICY IF EXISTS "Admins can select all lectures" ON public.lectures;
CREATE POLICY "Admins can select all lectures"
    ON public.lectures FOR SELECT
    USING (
        public.is_admin() OR 
        course_id IN (
            SELECT id FROM public.courses WHERE workspace_id IN (
                SELECT id FROM public.workspaces WHERE user_id = auth.uid()
            )
        )
    );

-- 3.5 ai_jobs policies
DROP POLICY IF EXISTS "Admins can select all ai_jobs" ON public.ai_jobs;
CREATE POLICY "Admins can select all ai_jobs"
    ON public.ai_jobs FOR SELECT
    USING (
        public.is_admin() OR 
        lecture_id IN (
            SELECT id FROM public.lectures WHERE course_id IN (
                SELECT id FROM public.courses WHERE workspace_id IN (
                    SELECT id FROM public.workspaces WHERE user_id = auth.uid()
                )
            )
        )
    );

-- 3.6 subscriptions policies
DROP POLICY IF EXISTS "Admins can select all subscriptions" ON public.subscriptions;
CREATE POLICY "Admins can select all subscriptions"
    ON public.subscriptions FOR SELECT
    USING (public.is_admin() OR user_id = auth.uid());


-- =========================================================================
-- 4. ADMIN MANAGEMENT RPC PROCEDURES
-- =========================================================================

-- 4.1 Soft-delete (Deactivate user account)
CREATE OR REPLACE FUNCTION public.admin_soft_delete_user(target_user_id uuid)
RETURNS void AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Access denied. Administrator privileges required.';
    END IF;

    UPDATE public.users
    SET deleted_at = NOW()
    WHERE id = target_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.admin_soft_delete_user(uuid) TO authenticated;

-- 4.2 Reactivate deactivated user account
CREATE OR REPLACE FUNCTION public.admin_reactivate_user(target_user_id uuid)
RETURNS void AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Access denied. Administrator privileges required.';
    END IF;

    UPDATE public.users
    SET deleted_at = NULL
    WHERE id = target_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.admin_reactivate_user(uuid) TO authenticated;

-- 4.3 Hard-delete (GDPR Permanent Purge)
CREATE OR REPLACE FUNCTION public.admin_hard_delete_user(target_user_id uuid)
RETURNS void AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Access denied. Administrator privileges required.';
    END IF;

    -- Deleting from auth.users triggers CASCADE deletion across public schema
    DELETE FROM auth.users WHERE id = target_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.admin_hard_delete_user(uuid) TO authenticated;
