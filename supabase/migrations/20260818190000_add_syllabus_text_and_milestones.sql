-- Migration: Add syllabus_text and exam_milestones (midterms & finals) to courses

ALTER TABLE public.courses
ADD COLUMN IF NOT EXISTS syllabus_text text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS exam_milestones jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.courses.syllabus_text IS 'Full raw or markdown syllabus text pasted by the student';
COMMENT ON COLUMN public.courses.exam_milestones IS 'Array of exam milestones [{ id, name, type, date, covered_topics }]';
