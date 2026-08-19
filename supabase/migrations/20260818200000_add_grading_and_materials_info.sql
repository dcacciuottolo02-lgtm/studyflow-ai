-- Migration: Add grading_policy and materials_info to courses

ALTER TABLE public.courses
ADD COLUMN IF NOT EXISTS grading_policy text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS materials_info text DEFAULT NULL;

COMMENT ON COLUMN public.courses.grading_policy IS 'Grading criteria, percentages, weights extracted from syllabus';
COMMENT ON COLUMN public.courses.materials_info IS 'Textbooks, recommended tools and lecture materials info';
