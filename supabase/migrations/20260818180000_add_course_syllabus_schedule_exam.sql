-- Migration: Add Syllabus, Schedule and Exam Date to Courses and Lectures

ALTER TABLE public.courses
ADD COLUMN IF NOT EXISTS exam_date date DEFAULT NULL,
ADD COLUMN IF NOT EXISTS cfu integer DEFAULT NULL,
ADD COLUMN IF NOT EXISTS syllabus_topics jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS schedule jsonb DEFAULT '[]'::jsonb;

ALTER TABLE public.lectures
ADD COLUMN IF NOT EXISTS syllabus_topic_id text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS slides_url text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS slides_name text DEFAULT NULL;

COMMENT ON COLUMN public.courses.exam_date IS 'Optional target exam date (YYYY-MM-DD)';
COMMENT ON COLUMN public.courses.syllabus_topics IS 'Array of syllabus topics [{ id, title, order_index }]';
COMMENT ON COLUMN public.courses.schedule IS 'Weekly class schedule [{ day, start_time, end_time, room }]';
COMMENT ON COLUMN public.lectures.syllabus_topic_id IS 'Linked syllabus topic ID';
COMMENT ON COLUMN public.lectures.slides_url IS 'Optional URL or storage path for professor slides PPT/PDF';
