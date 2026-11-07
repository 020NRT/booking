import { LogOut, Menu as MenuIcon, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { Logo } from './SiteLayout'

export interface NavItem {
  to: string
  label: string
  icon: ReactNode
  end?: boolean
}

/** Shared shell for the restaurant and super-admin panels (desktop + tablet). */
export default function PanelLayout({ title, nav, top }: { title: string; nav: NavItem[]; top?: ReactNode }) {
  const { user, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const loc = useLocation()
  useEffect(() => setOpen(false), [loc.pathname])

  const links = (
    <nav className="flex flex-col gap-0.5">
      {nav.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end}
          className={({ isActive }) => `flex items-center gap-3 px-3 h-10 rounded-xl text-sm font-medium transition ${isActive ? 'bg-ink text-white' : 'text-ink-2 hover:bg-zinc-100'}`}>
          {n.icon}{n.label}
        </NavLink>
      ))}
    </nav>
  )

  const side = (
    <div className="flex flex-col h-full p-4 gap-5">
      <div className="flex items-center justify-between">
        <Logo to="/" />
        <button className="lg:hidden size-9 grid place-items-center rounded-full hover:bg-zinc-100" onClick={() => setOpen(false)} aria-label="Закрыть"><X size={18} /></button>
      </div>
      <div className="text-[11px] font-bold uppercase tracking-wider text-muted px-3">{title}</div>
      {top}
      {links}
      <div className="mt-auto border-t border-line pt-4 text-sm">
        <div className="px-3 font-semibold truncate">{user?.name}</div>
        <div className="px-3 text-xs text-muted truncate">{user?.email}</div>
        <div className="flex gap-1 mt-3">
          <Link to="/" className="btn-ghost btn-sm flex-1">На сайт</Link>
          <button onClick={logout} className="btn-ghost btn-sm" aria-label="Выйти"><LogOut size={15} /></button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[250px_1fr]">
      <aside className="hidden lg:block sticky top-0 h-dvh border-r border-line bg-white">{side}</aside>
      {open && (
        <div className="lg:hidden fixed inset-0 z-50 bg-black/40" onClick={() => setOpen(false)}>
          <aside className="h-full w-[270px] bg-white fade-in" onClick={(e) => e.stopPropagation()}>{side}</aside>
        </div>
      )}
      <div className="min-w-0">
        <header className="lg:hidden sticky top-0 z-30 bg-paper/90 backdrop-blur border-b border-line h-14 px-4 flex items-center gap-3">
          <button className="size-9 grid place-items-center rounded-full hover:bg-zinc-100" onClick={() => setOpen(true)} aria-label="Меню"><MenuIcon size={18} /></button>
          <span className="font-bold">{title}</span>
        </header>
        <main className="p-4 sm:p-6 lg:p-8 max-w-[1400px]"><Outlet /></main>
      </div>
    </div>
  )
}

export function PageHead({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3 justify-between mb-6">
      <div>
        <h1 className="text-2xl sm:text-[28px] font-extrabold tracking-tight">{title}</h1>
        {sub && <div className="text-sm text-muted mt-1">{sub}</div>}
      </div>
      {actions && <div className="flex gap-2 flex-wrap">{actions}</div>}
    </div>
  )
}

export function StatCard({ label, value, hint, accent = false }: { label: string; value: ReactNode; hint?: ReactNode; accent?: boolean }) {
  return (
    <div className={`rounded-2xl p-4 sm:p-5 border ${accent ? 'bg-ink text-white border-ink' : 'bg-white border-line'}`}>
      <div className={`text-xs font-medium ${accent ? 'text-white/70' : 'text-muted'}`}>{label}</div>
      <div className="text-2xl sm:text-[28px] font-extrabold tracking-tight mt-1.5 tabular-nums">{value}</div>
      {hint && <div className={`text-xs mt-1 ${accent ? 'text-white/60' : 'text-muted'}`}>{hint}</div>}
    </div>
  )
}

/** Simple bar chart (no extra dependency). */
export function BarChart({ data, height = 160 }: { data: { label: string; value: number; sub?: number }[]; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.value + (d.sub ?? 0)))
  return (
    <div className="flex items-end gap-[3px] w-full" style={{ height }}>
      {data.map((d, i) => (
        <div key={i} className="group relative flex-1 flex flex-col justify-end h-full min-w-[4px]">
          <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 hidden group-hover:block whitespace-nowrap rounded-md bg-ink text-white text-[11px] px-2 py-1 z-10">
            {d.label}: {d.value}{d.sub ? ` / отм. ${d.sub}` : ''}
          </div>
          {!!d.sub && <div className="bg-rose-200 rounded-t-[3px]" style={{ height: `${(d.sub / max) * 100}%` }} />}
          <div className={`bg-accent ${d.sub ? '' : 'rounded-t-[3px]'}`} style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value ? 2 : 0 }} />
        </div>
      ))}
    </div>
  )
}
