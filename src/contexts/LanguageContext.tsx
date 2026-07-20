'use client'

import React, { createContext, useContext, useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import it from '@/locales/it'
import en from '@/locales/en'

type Language = 'it' | 'en'

const locales = { it, en }

interface LanguageContextType {
  language: Language
  setLanguage: (lang: Language) => Promise<void>
  t: (key: string, variables?: Record<string, string | number>) => string
  loading: boolean
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined)

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>('it')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // 1. Initial fallback load from localStorage
    const savedLang = localStorage.getItem('ui_language') as Language
    if (savedLang === 'it' || savedLang === 'en') {
      setLanguageState(savedLang)
    }

    // 2. Fetch authenticated preference from Supabase
    const fetchUserLanguage = async () => {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        
        if (user) {
          const { data: profileData } = await supabase
            .from('users')
            .select('ui_language')
            .eq('id', user.id)
            .maybeSingle()

          if (profileData?.ui_language === 'it' || profileData?.ui_language === 'en') {
            setLanguageState(profileData.ui_language)
            localStorage.setItem('ui_language', profileData.ui_language)
          }
        }
      } catch (err) {
        console.error('Failed to fetch user language preference:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchUserLanguage()
  }, [])

  const setLanguage = async (lang: Language) => {
    setLanguageState(lang)
    localStorage.setItem('ui_language', lang)
    
    // Attempt database save
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await supabase
          .from('users')
          .update({ ui_language: lang })
          .eq('id', user.id)
      }
    } catch (err) {
      console.error('Failed to save language preference to DB:', err)
    }
  }

  const t = (key: string, variables?: Record<string, string | number>): string => {
    const dictionary = locales[language] || locales.it
    // @ts-ignore
    let value = dictionary[key] || key

    if (variables && typeof value === 'string') {
      Object.entries(variables).forEach(([k, v]) => {
        value = value.replace(new RegExp(`{${k}}`, 'g'), String(v))
      })
    }
    
    return value
  }

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, loading }}>
      {children}
    </LanguageContext.Provider>
  )
}

export const useLanguage = () => {
  const context = useContext(LanguageContext)
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider')
  }
  return context
}
