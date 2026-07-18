'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, User } from 'lucide-react'

export default function BottomNav() {
  const pathname = usePathname()

  const navItems = [
    {
      name: 'Home',
      href: '/home',
      icon: <Home className="w-5 h-5" />,
    },
    {
      name: 'Profile',
      href: '/profile',
      icon: <User className="w-5 h-5" />,
    },
  ]

  return (
    <div className="fixed bottom-0 left-0 right-0 md:bottom-6 md:left-1/2 md:right-auto md:-translate-x-1/2 bg-white border-t border-slate-100 md:border md:rounded-full md:shadow-soft-md z-40 px-6 py-2 md:py-2 md:px-8 flex items-center justify-around md:justify-center md:gap-8 transition-all duration-300">
      {navItems.map((item) => {
        // Active if pathname equals the route exactly, or starts with it (for courses/id etc)
        const isActive =
          item.href === '/home'
            ? pathname === '/home' || pathname.startsWith('/course/') || pathname.startsWith('/lecture/')
            : pathname === item.href
            
        return (
          <Link
            key={item.name}
            href={item.href}
            className={`flex flex-col items-center gap-1.5 px-6 py-2 transition-all duration-200 ${
              isActive
                ? 'text-slate-950 scale-105'
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <div className="relative flex flex-col items-center">
              {item.icon}
              {isActive && (
                <div className="absolute -bottom-1.5 w-1 h-1 rounded-full bg-brand-gradient" />
              )}
            </div>
            <span className={`text-[9px] uppercase tracking-widest font-extrabold ${isActive ? 'text-slate-950 font-black' : 'text-slate-400'}`}>
              {item.name}
            </span>
          </Link>
        )
      })}
    </div>
  )
}
