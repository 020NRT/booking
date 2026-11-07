import { CalendarX2, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { Empty, ErrorBox, Field, PageLoader, StatusBadge, useAsync } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { fmtDate, fmtTime } from '../lib/format'
import { LANGS, useI18n, type Lang } from '../lib/i18n'
import type { Booking, RestaurantCard, User } from '../lib/types'
import { RestaurantTile } from './Home'

export function MeLayout() {
  const { t } = useI18n()
  const tab = ({ isActive }: { isActive: boolean }) => `chip ${isActive ? 'chip-active' : ''}`
  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 pt-8">
      <div className="flex gap-2 mb-6 overflow-x-auto no-scrollbar">
        <NavLink to="/me" end className={tab}>{t('my.title')}</NavLink>
        <NavLink to="/me/favorites" className={tab}>{t('my.favorites')}</NavLink>
        <NavLink to="/me/profile" className={tab}>{t('nav.profile')}</NavLink>
      </div>
      <Outlet />
    </div>
  )
}

export function MyBookings() {
  const { t, lang } = useI18n()
  const q = useAsync(() => api.get<Booking[]>('/me/bookings'), [])
  if (q.loading) return <PageLoader />
  if (q.error) return <ErrorBox error={q.error} />
  const now = Date.now()
  const all = q.data ?? []
  const upcoming = all
    .filter((b) => new Date(b.ends_at).getTime() > now && ['pending_payment', 'confirmed', 'checked_in'].includes(b.status))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  const past = all.filter((b) => !upcoming.includes(b))
  const card = (b: Booking) => (
    <Link key={b.id} to={`/bookings/${b.id}`} className="card p-4 flex items-center gap-4 hover:border-ink/25 transition">
      <div className="text-center w-14 shrink-0">
        <div className="text-2xl font-extrabold leading-none">{new Date(b.starts_at).toLocaleDateString('ru-RU', { day: 'numeric', timeZone: 'Asia/Almaty' })}</div>
        <div className="text-xs text-muted mt-1">{fmtTime(b.starts_at)}</div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold truncate">{b.restaurant_name}</div>
        <div className="text-sm text-muted truncate">{fmtDate(b.starts_at, lang)} · №{b.table_number} · {b.guests} {t('common.persons')}</div>
        <div className="mt-1.5"><StatusBadge status={b.status} /></div>
      </div>
      <ChevronRight size={18} className="text-muted" />
    </Link>
  )
  if (!all.length) return <Empty icon={<CalendarX2 size={36} />}>{t('my.empty')}<div className="mt-4"><Link to="/" className="btn-primary btn-sm">{t('nav.restaurants')}</Link></div></Empty>
  return (
    <div className="space-y-8">
      {upcoming.length > 0 && <section><h2 className="font-bold text-lg mb-3">{t('my.upcoming')}</h2><div className="space-y-3">{upcoming.map(card)}</div></section>}
      {past.length > 0 && <section><h2 className="font-bold text-lg mb-3">{t('my.past')}</h2><div className="space-y-3">{past.map(card)}</div></section>}
    </div>
  )
}

export function MyFavorites() {
  const { t } = useI18n()
  const q = useAsync(() => api.get<RestaurantCard[]>('/me/favorites'), [])
  if (q.loading) return <PageLoader />
  if (!q.data?.length) return <Empty>{t('my.empty')}</Empty>
  return <div className="grid gap-5 sm:grid-cols-2">{q.data.map((r) => <RestaurantTile key={r.id} r={r} />)}</div>
}

export function Profile() {
  const { t, lang, setLang } = useI18n()
  const { user, setUser } = useAuth()
  const [form, setForm] = useState({ name: user?.name ?? '', email: user?.email ?? '', phone: user?.phone ?? '' })
  const [pw, setPw] = useState({ current_password: '', new_password: '' })
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [pwMsg, setPwMsg] = useState<string | null>(null)
  const [pwErr, setPwErr] = useState<unknown>(null)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    setMsg(null)
    try {
      const u = await api.patch<User>('/auth/me', { name: form.name, email: form.email || null, phone: form.phone || null, language: lang })
      setUser(u)
      setMsg(t('profile.saved'))
    } catch (e) {
      setErr(e)
    }
  }
  const changePw = async (e: React.FormEvent) => {
    e.preventDefault()
    setPwErr(null)
    setPwMsg(null)
    try {
      await api.post('/auth/me/password', pw)
      setPw({ current_password: '', new_password: '' })
      setPwMsg(t('profile.saved'))
    } catch (e) {
      setPwErr(e)
    }
  }
  return (
    <div className="grid md:grid-cols-2 gap-6">
      <form onSubmit={save} className="card p-5 space-y-4">
        <h2 className="font-bold text-lg">{t('profile.title')}</h2>
        <Field label={t('auth.name')}><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={120} /></Field>
        <Field label="Email"><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label={t('b.phone')}><input className="input" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        <Field label={t('profile.language')}>
          <select className="input" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
            {(Object.keys(LANGS) as Lang[]).map((l) => <option key={l} value={l}>{LANGS[l]}</option>)}
          </select>
        </Field>
        <ErrorBox error={err} />
        {msg && <div className="text-sm text-emerald-700">{msg}</div>}
        <button className="btn-primary">{t('profile.save')}</button>
      </form>
      <form onSubmit={changePw} className="card p-5 space-y-4 h-max">
        <h2 className="font-bold text-lg">{t('profile.password')}</h2>
        <Field label={t('profile.current')}><input className="input" type="password" autoComplete="current-password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} required /></Field>
        <Field label={t('profile.new')} hint={t('auth.passwordHint')}><input className="input" type="password" autoComplete="new-password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} required minLength={8} /></Field>
        <ErrorBox error={pwErr} />
        {pwMsg && <div className="text-sm text-emerald-700">{pwMsg}</div>}
        <button className="btn-ghost">{t('profile.save')}</button>
      </form>
    </div>
  )
}
