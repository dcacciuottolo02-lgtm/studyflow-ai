-- 20260716010000_storage_setup.sql
-- Migration: Setup Supabase Storage Bucket for Lectures and RLS Policies

-- =========================================================================
-- 1. CREATE BUCKET
-- =========================================================================

-- Insert the 'lecture-resources' bucket if it doesn't already exist.
-- The bucket is created as private (public = false).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'lecture-resources', 
    'lecture-resources', 
    false, 
    524288000, -- 500MB in bytes
    ARRAY['audio/webm', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/x-m4a', 'audio/m4a', 'audio/x-webm', 'video/webm']
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 524288000,
    allowed_mime_types = ARRAY['audio/webm', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/x-m4a', 'audio/m4a', 'audio/x-webm', 'video/webm'];

-- =========================================================================
-- 2. DEFINE RLS POLICIES FOR 'lecture-resources' BUCKET
-- =========================================================================

-- Note: RLS is enabled by default on storage.objects.
-- Drop policies if they already exist to avoid errors on migration reruns
DROP POLICY IF EXISTS "Allow authenticated uploads to user folder" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated read of user folder" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated deletion of user folder" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated updates of user folder" ON storage.objects;

-- 2.1 Policy for Uploads (INSERT)
-- Users can only upload files if the first folder level matches their auth.uid()
CREATE POLICY "Allow authenticated uploads to user folder" ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'lecture-resources' AND
        auth.uid()::text = split_part(name, '/', 1)
    );

-- 2.2 Policy for Reads (SELECT)
-- Users can only download/access files if the first folder level matches their auth.uid()
CREATE POLICY "Allow authenticated read of user folder" ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'lecture-resources' AND
        auth.uid()::text = split_part(name, '/', 1)
    );

-- 2.3 Policy for Deletions (DELETE)
-- Users can only delete files if the first folder level matches their auth.uid()
CREATE POLICY "Allow authenticated deletion of user folder" ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'lecture-resources' AND
        auth.uid()::text = split_part(name, '/', 1)
    );

-- 2.4 Policy for Overwriting/Updates (UPDATE)
-- Users can only modify metadata or overwrite files if the first folder level matches their auth.uid()
CREATE POLICY "Allow authenticated updates of user folder" ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
        bucket_id = 'lecture-resources' AND
        auth.uid()::text = split_part(name, '/', 1)
    );
