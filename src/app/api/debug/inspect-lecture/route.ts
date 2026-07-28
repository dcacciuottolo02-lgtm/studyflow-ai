'use strict'

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/utils/supabase/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerClient()

    const { data: lectures, error: lecErr } = await supabase
      .from('lectures')
      .select(`
        id, title, status, duration_seconds, transcript_text, created_at,
        courses ( name )
      `)
      .order('created_at', { ascending: false })
      .limit(10)

    if (lecErr) {
      return NextResponse.json({ error: lecErr.message }, { status: 500 })
    }

    const lectureIds = lectures?.map((l) => l.id) || []

    const { data: jobs } = await supabase
      .from('ai_jobs')
      .select('*')
      .in('lecture_id', lectureIds)

    const { data: resources } = await supabase
      .from('resources')
      .select('*')
      .in('lecture_id', lectureIds)

    const { data: studyMaterials } = await supabase
      .from('study_materials')
      .select('*')
      .in('lecture_id', lectureIds)

    const smIds = studyMaterials?.map((sm) => sm.id) || []

    const { data: summaries } = await supabase
      .from('summaries')
      .select('id, study_material_id, content, key_concepts')
      .in('study_material_id', smIds)

    return NextResponse.json({
      lectures,
      jobs,
      resources,
      studyMaterials,
      summariesCount: summaries?.length || 0,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
