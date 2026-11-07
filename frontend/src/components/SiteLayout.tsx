import { CalendarCheck, LayoutDashboard, LogOut, Shield, User as UserIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { LANGS, useI18n, type Lang } from '../lib/i18n'

export function Logo({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="flex items-center gap-2 font-extrabold text-[19px] tracking-tight">
      <span className="relative grid place-items-center size-8 rounded-[10px] bg-ink">
        <span className="size-3.5 rounded-full border-[3px] border-white" />
        <span className="absolute size-1.5 rounded-full bg-accent" />
      </span>
      Reserve
    </Link>
  )
}

export function LangSwitch() {
  const { lang, setLang } = useI18n()
  return (
    <div className="flex rounded-full bg-zinc-100 p-0.5 text-xs font-semibold">
      {(Object.keys(LANGS) as Lang[]).map((l) => (
        <button key={l} onClick={() => setLang(l)}
          className={`px-2.5 h-7 rounded-full transition ${lang === l ? 'bg-white shadow-sm text-ink' : 'text-muted'}`}>
          {LANGS[l]}
        </button>
      ))}
    </div>
  )
}

function UserMenu() {
  const { user, logout } = useAuth()
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const loc = useLocation()
  useEffect(() => setOpen(false), [loc.pathname])
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  if (!user) return null
  const item = 'flex items-center gap-2.5 px-3 h-10 rounded-xl text-sm hover:bg-zinc-100 w-full text-left'
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="size-9 rounded-full bg-ink text-white font-bold text-sm grid place-items-center" aria-label={t('nav.profile')}>
        {user.name.trim()[0]?.toUpperCase() ?? 'R'}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-60 card shadow-xl p-1.5 fade-in z-40">
          <div className="px-3 py-2 text-sm">
            <div className="font-semibold truncate">{user.name}</div>
            <div className="text-muted text-xs truncate">{user.email ?? user.phone}</div>
          </div>
          <Link to="/me" className={item}><CalendarCheck size={16} />{t('nav.myBookings')}</Link>
          <Link to="/me/profile" className={item}><UserIcon size={16} />{t('nav.profile')}</Link>
          {(user.role === 'restaurant_admin' || user.role === 'super_admin') && (
            <Link to="/partner" className={item}><LayoutDashboard size={16} />{t('nav.partner')}</Link>
          )}
          {user.role === 'super_admin' && <Link to="/admin" className={item}><Shield size={16} />{t('nav.admin')}</Link>}
          <button onClick={logout} className={`${item} text-red-600`}><LogOut size={16} />{t('nav.logout')}</button>
        </div>
      )}
    </div>
  )
}

export default function SiteLayout() {
  const { user, ready } = useAuth()
  const { t } = useI18n()
  const loc = useLocation()
  return (
    <div className="min-h-dvh flex flex-col">
      <header className="sticky top-0 z-30 bg-paper/85 backdrop-blur-xl border-b border-line/70">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center gap-4">
          <Logo />
          <nav className="hidden sm:flex items-center gap-1 ml-4 text-sm font-medium text-ink-2">
            <NavLink to="/" end className={({ isActive }) => `px-3 h-9 grid place-items-center rounded-full ${isActive ? 'bg-zinc-100 text-ink' : 'hover:text-ink'}`}>{t('nav.restaurants')}</NavLink>
            {user && <NavLink to="/me" end className={({ isActive }) => `px-3 h-9 grid place-items-center rounded-full ${isActive ? 'bg-zinc-100 text-ink' : 'hover:text-ink'}`}>{t('nav.myBookings')}</NavLink>}
          </nav>
          <div className="ml-auto flex items-center gap-2.5">
            <LangSwitch />
            {ready && !user && (
              <Link to={`/login?next=${encodeURIComponent(loc.pathname)}`} className="btn-primary btn-sm">{t('nav.login')}</Link>
            )}
            <UserMenu />
          </div>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-line mt-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 flex flex-col sm:flex-row gap-3 justify-between text-sm text-muted">
          <span>© {new Date().getFullYear()} Reserve · Астана</span>
          <span>Бронирование столиков онлайн</span>
        </div>
      </footer>
    </div>
  )
}
