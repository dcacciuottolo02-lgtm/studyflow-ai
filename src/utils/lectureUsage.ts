import { createClient } from '@/utils/supabase/client'

export interface UsageStatus {
  plan: 'free' | 'pro'
  used: number
  limit: number
  isExceeded: boolean
}

/**
 * Checks the user's plan and monthly processed lecture count.
 * A lecture is counted if its status is 'queued', 'processing', 'completed', or 'failed'
 * (which means AI processing has been initiated for it).
 */
export async function checkUsageStatus(): Promise<UsageStatus> {
  const defaultStatus: UsageStatus = {
    plan: 'free',
    used: 0,
    limit: 3,
    isExceeded: false,
  }

  try {
    const supabase = createClient()
    
    // 1. Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      console.warn('[Usage] User not logged in, returning default free tier status')
      return defaultStatus
    }

    // 2. Get user plan from 'users' table
    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('plan')
      .eq('id', user.id)
      .maybeSingle()

    if (profileError) {
      console.error('[Usage] Error fetching user profile:', profileError)
    }

    const plan = (profile?.plan === 'pro') ? 'pro' : 'free'
    const limit = plan === 'pro' ? 12 : 3

    // 3. Count current month's processed lectures
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

    const { count, error: countError } = await supabase
      .from('lectures')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', startOfMonth)
      .is('deleted_at', null)
      .in('status', ['queued', 'processing', 'completed', 'failed'])

    if (countError) {
      console.error('[Usage] Error counting monthly lectures:', countError)
      // Fail-safe: assume 0 used so we don't lock out the user in case of query failure
      return {
        plan,
        used: 0,
        limit,
        isExceeded: false,
      }
    }

    const used = count || 0
    const isExceeded = used >= limit

    return {
      plan,
      used,
      limit,
      isExceeded,
    }
  } catch (err) {
    console.error('[Usage] Unexpected error checking usage status:', err)
    return defaultStatus
  }
}
