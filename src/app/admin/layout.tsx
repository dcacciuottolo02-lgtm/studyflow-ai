import { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'

export const metadata = {
  title: 'Admin Dashboard | StudyFlow AI',
  description: 'Pannello di controllo amministrativo per il monitoraggio di StudyFlow AI',
}

export default async function AdminLayout({
  children,
}: {
  children: ReactNode
}) {
  const supabase = await createClient()

  // 1. Verify authenticated session
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect('/login')
  }

  // 2. Query public.users to check is_admin flag
  const { data: userProfile, error: profileError } = await supabase
    .from('users')
    .select('is_admin, plan, name')
    .eq('id', user.id)
    .single()

  // 3. Strict Server-Side Admin Guard: If not admin, redirect to /home immediately
  if (profileError || !userProfile || !userProfile.is_admin) {
    console.warn(`[Admin Guard Access Denied] User ${user.id} (${user.email}) attempted to access /admin without is_admin=true.`)
    redirect('/home')
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans antialiased selection:bg-indigo-500 selection:text-white">
      {children}
    </div>
  )
}
