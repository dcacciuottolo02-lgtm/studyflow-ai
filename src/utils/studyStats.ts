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

      // Check if last_study_date was before yesterday (streak broken)
      if (data.last_study_date && data.last_study_date < yesterdayStr) {
        updatedStats.current_streak = 1
        updatedStats.completed_today_count = 0
        needsSync = true
      } else if (data.last_study_date === yesterdayStr && data.completed_today_count > 0) {
        // Rolled over to new day, reset today's count
        updatedStats.completed_today_count = 0
        needsSync = true
      }

      if (needsSync) {
        await supabase
          .from('user_study_stats')
          .update({
            current_streak: updatedStats.current_streak,
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
      completed_today_count: 1,
      total_flashcards_reviewed: 0,
      total_quizzes_completed: 0,
      total_study_minutes: 5,
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
      completed_today_count: 1,
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
      newStreak += 1
      if (newStreak > newLongest) {
        newLongest = newStreak
      }
      newTodayCount = 1
    } else if (current.last_study_date < yesterdayStr) {
      newStreak = 1
      newTodayCount = 1
    }

    const flashcardsDelta = activityType === 'flashcard' ? extraCount : 0
    const quizDelta = activityType === 'quiz' ? extraCount : 0
    const minutesDelta = activityType === 'lecture_view' ? 8 : activityType === 'quiz' ? 5 : 3

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
