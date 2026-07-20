'use strict'

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/utils/supabase/server'

export const maxDuration = 300

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let lectureId = ''
  try {
    const resolvedParams = await params
    lectureId = resolvedParams.id

    // Initialize Supabase Server Client
    const supabase = await createServerClient()
    
    // Validate session
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session || !session.access_token) {
      return NextResponse.json(
        { error: 'Unauthorized. Authenticated session required.' },
        { status: 401 }
      )
    }

    // Parse choices from request body (or default to empty if not provided)
    const body = await request.json().catch(() => ({}))
    
    let generateSummary = body.generateSummary
    let generateFlashcards = body.generateFlashcards
    let generateQuiz = body.generateQuiz

    const isIncremental = generateSummary !== undefined || generateFlashcards !== undefined || generateQuiz !== undefined

    // If not incremental (e.g. legacy or retry without body), deduce from existing jobs or default to all
    if (!isIncremental) {
      const { data: existingJobs } = await supabase
        .from('ai_jobs')
        .select('job_type')
        .eq('lecture_id', lectureId)

      if (existingJobs && existingJobs.length > 0) {
        generateSummary = existingJobs.some((j) => j.job_type === 'summary')
        generateFlashcards = existingJobs.some((j) => j.job_type === 'flashcards')
        generateQuiz = existingJobs.some((j) => j.job_type === 'quiz')
      } else {
        generateSummary = true
        generateFlashcards = true
        generateQuiz = true
      }
    }

    // Check if transcription job is already completed
    const { data: existingJobs } = await supabase
      .from('ai_jobs')
      .select('job_type, status')
      .eq('lecture_id', lectureId)

    const isTranscriptionCompleted = existingJobs?.some(
      (j: any) => j.job_type === 'transcription' && j.status === 'completed'
    )

    console.log(
      `[Route POST] Queueing AI pipeline via Supabase Edge Function for lecture: ${lectureId}. ` +
      `isIncremental: ${isIncremental}, isTranscriptionCompleted: ${isTranscriptionCompleted}`
    )

    // Insert new jobs in 'queued' state
    const jobsToInsert = []

    if (!isTranscriptionCompleted) {
      await supabase.from('ai_jobs').delete().eq('lecture_id', lectureId).eq('job_type', 'transcription')
      jobsToInsert.push({
        lecture_id: lectureId,
        job_type: 'transcription',
        status: 'queued',
      })
    }

    if (generateSummary) {
      await supabase.from('ai_jobs').delete().eq('lecture_id', lectureId).eq('job_type', 'summary')
      jobsToInsert.push({
        lecture_id: lectureId,
        job_type: 'summary',
        status: 'queued',
      })
    }

    if (generateFlashcards) {
      await supabase.from('ai_jobs').delete().eq('lecture_id', lectureId).eq('job_type', 'flashcards')
      jobsToInsert.push({
        lecture_id: lectureId,
        job_type: 'flashcards',
        status: 'queued',
      })
    }

    if (generateQuiz) {
      await supabase.from('ai_jobs').delete().eq('lecture_id', lectureId).eq('job_type', 'quiz')
      jobsToInsert.push({
        lecture_id: lectureId,
        job_type: 'quiz',
        status: 'queued',
      })
    }

    if (jobsToInsert.length > 0) {
      const { error: queueErr } = await supabase.from('ai_jobs').insert(jobsToInsert)
      if (queueErr) {
        return NextResponse.json(
          { error: `Failed to initialize jobs: ${queueErr.message}` },
          { status: 500 }
        )
      }
    }

    // Update lecture status to 'queued' to trigger front-end polling
    const { error: lectureUpdErr } = await supabase
      .from('lectures')
      .update({ status: 'queued' })
      .eq('id', lectureId)

    if (lectureUpdErr) {
      return NextResponse.json(
        { error: `Failed to update lecture status: ${lectureUpdErr.message}` },
        { status: 500 }
      )
    }

    // Invoke the Supabase Edge Function to handle the background processing
    const { data: invokeData, error: invokeErr } = await supabase.functions.invoke('process-lecture', {
      body: {
        lectureId,
        generateSummary,
        generateFlashcards,
        generateQuiz,
      },
    })

    if (invokeErr) {
      console.error('[Route POST] Supabase Edge Function invocation failed:', invokeErr)

      // Rollback lecture status to failed
      await supabase
        .from('lectures')
        .update({ status: 'failed' })
        .eq('id', lectureId)

      // Set the queued jobs to failed
      await supabase
        .from('ai_jobs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: `Failed to trigger Edge Function: ${invokeErr.message || invokeErr}`,
        })
        .eq('lecture_id', lectureId)
        .eq('status', 'queued')

      return NextResponse.json(
        { error: `Failed to start AI processing on Supabase: ${invokeErr.message}` },
        { status: 500 }
      )
    }

    return NextResponse.json(
      { success: true, status: 'queued', message: 'Processing started in background on Supabase.', invokeData },
      { status: 202 }
    )
  } catch (err: any) {
    console.error('[Route POST] Fatal error:', err)

    // Attempt rollback
    try {
      const supabase = await createServerClient()
      await supabase.from('lectures').update({ status: 'failed' }).eq('id', lectureId)
      await supabase
        .from('ai_jobs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: `Fatal server error: ${err.message}`,
        })
        .eq('lecture_id', lectureId)
        .eq('status', 'queued')
    } catch (dbErr) {
      console.error('[Route POST] Failed to rollback status in database:', dbErr)
    }

    return NextResponse.json(
      { error: err.message || 'Internal Server Error' },
      { status: 500 }
    )
  }
}
