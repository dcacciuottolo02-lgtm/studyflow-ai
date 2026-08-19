import { SupabaseClient } from '@supabase/supabase-js'

export interface UserStudyStats {
  id?: string
  user_id: string
  current_streak: number
  longest_streak: number
  last_study_date: string // YYYY-MM-DD
  daily_goal_target: number
  completed_today_count: number
  total_flashcards_reviewed: number
  total_quizzes_completed: number
  total_study_minutes: number
}

export interface TodayTaskItem {
  id: string
  lectureId: string
  lectureTitle: string
  courseId: string
  courseName: string
  courseColor: string
  taskType: 'summary' | 'flashcards' | 'quiz' | 'weak_concepts'
  urgencyScore: number
  urgencyReason: string
  urgencyBadge: 'fresh' | 'spaced_rep' | 'weak_spot' | 'review'
  estimatedMinutes: number
  hasSummary: boolean
  flashcardsCount: number
  hasQuiz: boolean
  targetTab: 'summary' | 'flashcards' | 'quiz'
}

// Helper to get formatted YYYY-MM-DD for local client date
export function getLocalDateString(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Helper to get yesterday's YYYY-MM-DD
export function getYesterdayDateString(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return getLocalDateString(d)
}

/**
 * Fetch or initialize the user study stats from Supabase
 */
export async function getOrCreateUserStats(
  supabase: SupabaseClient,
  userId: string
): Promise<UserStudyStats> {
  const todayStr = getLocalDateString()
  const yesterdayStr = getYesterdayDateString()

  try {
    const { data, error } = await supabase
      .from('user_study_stats')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()

    if (error && error.code !== 'PGRST116') {
      console.error('[StudyStats] Fetch error:', error)
    }

    if (data) {
      let updatedStats = { ...data }
      let needsSync = false

      if (!data.last_study_date) {
        updatedStats.last_study_date = todayStr
        updatedStats.current_streak = 1
        updatedStats.longest_streak = Math.max(data.longest_streak || 1, 1)
        needsSync = true
      } else if (data.last_study_date === yesterdayStr) {
        // Studied yesterday, now active today -> increment streak
        updatedStats.current_streak = (data.current_streak || 0) + 1
        updatedStats.longest_streak = Math.max(data.longest_streak || 1, updatedStats.current_streak)
        updatedStats.last_study_date = todayStr
        updatedStats.completed_today_count = 0
        needsSync = true
      } else if (data.last_study_date < yesterdayStr) {
        // Streak broken (>1 day gap) -> restart streak at 1
        updatedStats.current_streak = 1
        updatedStats.last_study_date = todayStr
        updatedStats.completed_today_count = 0
        needsSync = true
      } else if (data.last_study_date === todayStr) {
        // Already active today
        if (data.current_streak < 1) {
          updatedStats.current_streak = 1
          needsSync = true
        }
      }

      if (needsSync) {
        await supabase
          .from('user_study_stats')
          .update({
            current_streak: updatedStats.current_streak,
            longest_streak: updatedStats.longest_streak,
            last_study_date: updatedStats.last_study_date,
            completed_today_count: updatedStats.completed_today_count,
          })
          .eq('user_id', userId)
      }

      return updatedStats
    }

    // Default initial record
    const initialStats: UserStudyStats = {
      user_id: userId,
      current_streak: 1,
      longest_streak: 1,
      last_study_date: todayStr,
      daily_goal_target: 3,
      completed_today_count: 0,
      total_flashcards_reviewed: 0,
      total_quizzes_completed: 0,
      total_study_minutes: 0,
    }

    const { data: inserted, error: insertError } = await supabase
      .from('user_study_stats')
      .insert(initialStats)
      .select()
      .maybeSingle()

    if (insertError) {
      console.error('[StudyStats] Insert initial error:', insertError)
      return initialStats
    }

    return inserted || initialStats
  } catch (err) {
    console.error('[StudyStats] Catch error:', err)
    return {
      user_id: userId,
      current_streak: 1,
      longest_streak: 1,
      last_study_date: todayStr,
      daily_goal_target: 3,
      completed_today_count: 0,
      total_flashcards_reviewed: 0,
      total_quizzes_completed: 0,
      total_study_minutes: 0,
    }
  }
}

/**
 * Record a study activity (Flashcard review, Quiz attempt, Lecture summary review, Audio recording)
 */
export async function recordStudyActivity(
  supabase: SupabaseClient,
  userId: string,
  activityType: 'flashcard' | 'quiz' | 'lecture_view' | 'recording',
  extraCount: number = 1
): Promise<UserStudyStats | null> {
  const todayStr = getLocalDateString()
  const yesterdayStr = getYesterdayDateString()

  try {
    const current = await getOrCreateUserStats(supabase, userId)
    let newStreak = current.current_streak || 1
    let newLongest = current.longest_streak || 1
    let newTodayCount = (current.completed_today_count || 0) + 1

    if (current.last_study_date === yesterdayStr) {
      newStreak = (current.current_streak || 0) + 1
      if (newStreak > newLongest) {
        newLongest = newStreak
      }
      newTodayCount = 1
    } else if (current.last_study_date && current.last_study_date < yesterdayStr) {
      newStreak = 1
      newTodayCount = 1
    }

    const flashcardsDelta = activityType === 'flashcard' ? extraCount : 0
    const quizDelta = activityType === 'quiz' ? extraCount : 0
    const minutesDelta = activityType === 'recording' ? 15 : activityType === 'lecture_view' ? 6 : activityType === 'quiz' ? 5 : 3

    const updatePayload = {
      user_id: userId,
      current_streak: newStreak,
      longest_streak: newLongest,
      last_study_date: todayStr,
      completed_today_count: newTodayCount,
      total_flashcards_reviewed: (current.total_flashcards_reviewed || 0) + flashcardsDelta,
      total_quizzes_completed: (current.total_quizzes_completed || 0) + quizDelta,
      total_study_minutes: (current.total_study_minutes || 0) + minutesDelta,
    }

    const { data: updated, error } = await supabase
      .from('user_study_stats')
      .upsert(updatePayload, { onConflict: 'user_id' })
      .select()
      .maybeSingle()

    if (error) {
      console.error('[StudyStats] Record activity upsert error:', error)
      return null
    }

    return updated
  } catch (err) {
    console.error('[StudyStats] Record activity catch error:', err)
    return null
  }
}

/**
 * Mark a lecture task as completed for today
 */
export function markLectureCompletedToday(userId: string, lectureId: string): void {
  if (typeof window === 'undefined' || !userId || !lectureId) return
  const todayStr = getLocalDateString()
  const storageKey = `studyflow_completed_tasks_${userId}_${todayStr}`
  try {
    const raw = localStorage.getItem(storageKey)
    const set = new Set<string>(raw ? JSON.parse(raw) : [])
    set.add(lectureId)
    localStorage.setItem(storageKey, JSON.stringify(Array.from(set)))
  } catch (e) {
    console.error('[StudyStats] Error saving completed task:', e)
  }
}

/**
 * Get all lecture IDs completed for today
 */
export function getCompletedLecturesToday(userId: string): string[] {
  if (typeof window === 'undefined' || !userId) return []
  const todayStr = getLocalDateString()
  const storageKey = `studyflow_completed_tasks_${userId}_${todayStr}`
  try {
    const raw = localStorage.getItem(storageKey)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

/**
 * Multi-Course Urgency & Priority Algorithm (Ebbinghaus Spaced Repetition + Weak Points)
 */
export function buildMultiCourseTodayQueue(
  lectures: any[],
  studyMaterialsMap: Record<string, any>
): TodayTaskItem[] {
  const queue: TodayTaskItem[] = []
  const now = Date.now()

  lectures.forEach((lecture) => {
    if (lecture.status === 'deleted' || lecture.status === 'failed') return

    const courseInfo = (Array.isArray(lecture.courses) ? lecture.courses[0] : lecture.courses) || {}
    const sm = studyMaterialsMap[lecture.id]
    const flashcardSets = Array.isArray(sm?.flashcard_sets)
      ? sm.flashcard_sets
      : sm?.flashcard_sets
      ? [sm.flashcard_sets]
      : []
    const quizSets = Array.isArray(sm?.quiz_sets)
      ? sm.quiz_sets
      : sm?.quiz_sets
      ? [sm.quiz_sets]
      : []
    const flashcardsList = (flashcardSets[0]?.flashcards as any[]) || []
    const quizzesList = (quizSets[0]?.quiz_questions as any[]) || []
    const hasSummary = Boolean(
      sm?.summaries &&
        (Array.isArray(sm.summaries)
          ? sm.summaries.length > 0
          : Boolean(sm.summaries?.id || sm.summaries))
    )
    const hasFlashcards = flashcardsList.length > 0
    const hasQuiz = quizzesList.length > 0

    const recordedTime = new Date(lecture.recorded_at || lecture.created_at).getTime()
    const daysAgo = Math.max(0, Math.floor((now - recordedTime) / (1000 * 60 * 60 * 24)))

    const unknownCardsCount = flashcardsList.filter((fc: any) => fc.status === 'unknown').length
    const unseenCardsCount = flashcardsList.filter((fc: any) => fc.status === 'unseen').length

    // Case 1: Critical Weak Spots detected (Highest Priority)
    if (unknownCardsCount > 0) {
      queue.push({
        id: `${lecture.id}-weak`,
        lectureId: lecture.id,
        lectureTitle: lecture.title || 'Lezione',
        courseId: courseInfo.id || lecture.course_id,
        courseName: courseInfo.name || 'Corso',
        courseColor: courseInfo.color || '#ef4444',
        taskType: 'weak_concepts',
        urgencyScore: 98 - Math.min(10, daysAgo),
        urgencyReason: `⚠️ ${unknownCardsCount} punti deboli da rafforzare`,
        urgencyBadge: 'weak_spot',
        estimatedMinutes: 4,
        hasSummary,
        flashcardsCount: unknownCardsCount,
        hasQuiz,
        targetTab: 'flashcards',
      })
    }
    // Case 2: Fresh Lesson (< 24h - 48h) needing first consolidation
    else if (daysAgo <= 2) {
      queue.push({
        id: `${lecture.id}-fresh`,
        lectureId: lecture.id,
        lectureTitle: lecture.title || 'Lezione Recente',
        courseId: courseInfo.id || lecture.course_id,
        courseName: courseInfo.name || 'Corso',
        courseColor: courseInfo.color || '#6366f1',
        taskType: 'summary',
        urgencyScore: 92 - daysAgo * 5,
        urgencyReason: daysAgo === 0 ? '🔥 Lezione di oggi (Fissa i concetti)' : '✨ Lezione recente (Giorno +1)',
        urgencyBadge: 'fresh',
        estimatedMinutes: 6,
        hasSummary,
        flashcardsCount: flashcardsList.length,
        hasQuiz,
        targetTab: hasSummary ? 'summary' : hasFlashcards ? 'flashcards' : 'summary',
      })
    }
    // Case 3: Day 3 to 5 Spaced Repetition (Quiz Active Recall)
    else if (daysAgo >= 3 && daysAgo <= 7 && hasQuiz) {
      queue.push({
        id: `${lecture.id}-quiz`,
        lectureId: lecture.id,
        lectureTitle: lecture.title || 'Lezione',
        courseId: courseInfo.id || lecture.course_id,
        courseName: courseInfo.name || 'Corso',
        courseColor: courseInfo.color || '#f59e0b',
        taskType: 'quiz',
        urgencyScore: 85 - (daysAgo - 3) * 2,
        urgencyReason: '🎯 Curva dell\'oblio (Test di ritenzione)',
        urgencyBadge: 'spaced_rep',
        estimatedMinutes: 5,
        hasSummary,
        flashcardsCount: flashcardsList.length,
        hasQuiz,
        targetTab: 'quiz',
      })
    }
    // Case 4: Unseen flashcards in active course
    else if (unseenCardsCount > 0) {
      queue.push({
        id: `${lecture.id}-cards`,
        lectureId: lecture.id,
        lectureTitle: lecture.title || 'Lezione',
        courseId: courseInfo.id || lecture.course_id,
        courseName: courseInfo.name || 'Corso',
        courseColor: courseInfo.color || '#10b981',
        taskType: 'flashcards',
        urgencyScore: 75,
        urgencyReason: `🧠 ${unseenCardsCount} nuove flashcard da scoprire`,
        urgencyBadge: 'review',
        estimatedMinutes: 5,
        hasSummary,
        flashcardsCount: unseenCardsCount,
        hasQuiz,
        targetTab: 'flashcards',
      })
    }
    // Case 5: Standard Periodic Review
    else {
      queue.push({
        id: `${lecture.id}-review`,
        lectureId: lecture.id,
        lectureTitle: lecture.title || 'Lezione',
        courseId: courseInfo.id || lecture.course_id,
        courseName: courseInfo.name || 'Corso',
        courseColor: courseInfo.color || '#6366f1',
        taskType: 'summary',
        urgencyScore: Math.max(50, 70 - daysAgo),
        urgencyReason: '🔄 Ripasso programmato',
        urgencyBadge: 'review',
        estimatedMinutes: 5,
        hasSummary,
        flashcardsCount: flashcardsList.length,
        hasQuiz,
        targetTab: 'summary',
      })
    }
  })

  // Sort by highest urgency score first
  const sorted = queue.sort((a, b) => b.urgencyScore - a.urgencyScore)

  // Guarantee 100% deduplication by lectureId
  const uniqueMap = new Map<string, TodayTaskItem>()
  for (const item of sorted) {
    if (!uniqueMap.has(item.lectureId)) {
      uniqueMap.set(item.lectureId, item)
    }
  }

  return Array.from(uniqueMap.values())
}
