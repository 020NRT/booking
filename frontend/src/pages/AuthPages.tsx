import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Logo } from '../components/SiteLayout'
import { ErrorBox, Field, Spinner } from '../components/ui'
import { homeFor, useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'

function safeNext(next: string | null): string | null {
  // only allow same-site relative paths (prevents open redirects)
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh grid place-items-center px-4 py-10 bg-[radial-gradient(1200px_600px_at_80%_-10%,#e0e7ff_0%,transparent_60%),radial-gradient(900px_500px_at_-10%_110%,#fff1e0_0%,transparent_60%)]">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8"><Logo /></div>
        <div className="card p-6 sm:p-7 shadow-[0_20px_60px_-30px_rgba(0,0,0,.25)]">
          <h1 className="text-2xl font-bold tracking-tight mb-5">{title}</h1>
          {children}
        </div>
      </div>
    </div>
  )
}

export function LoginPage() {
  const { t } = useI18n()
  const { login } = useAuth()
  const nav = useNavigate()
  const [sp] = useSearchParams()
  const next = safeNext(sp.get('next'))
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      const u = await login(identifier, password)
      nav(next ?? homeFor(u), { replace: true })
    } catch (e) {
      setErr(e)
      setBusy(false)
    }
  }
  return (
    <Shell title={t('auth.login')}>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t('auth.identifier')}>
          <input className="input" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" required autoFocus />
        </Field>
        <Field label={t('auth.password')}>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </Field>
        <ErrorBox error={err} />
        <button className="btn-primary w-full h-12" disabled={busy}>{busy && <Spinner />}{t('auth.submitLogin')}</button>
      </form>
      <p className="text-sm text-muted mt-5 text-center">
        {t('auth.noAccount')} <Link className="text-ink font-semibold" to={`/register${next ? `?next=${encodeURIComponent(next)}` : ''}`}>{t('auth.register')}</Link>
      </p>
    </Shell>
  )
}

export function RegisterPage() {
  const { t } = useI18n()
  const { register } = useAuth()
  const nav = useNavigate()
  const [sp] = useSearchParams()
  const next = safeNext(sp.get('next'))
  const [f, setF] = useState({ name: '', email: '', phone: '', password: '' })
  const [err, setErr] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      await register({ name: f.name, email: f.email || undefined, phone: f.phone || undefined, password: f.password })
      nav(next ?? '/', { replace: true })
    } catch (e) {
      setErr(e)
      setBusy(false)
    }
  }
  return (
    <Shell title={t('auth.register')}>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t('auth.name')}><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" required maxLength={120} /></Field>
        <Field label="Email"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" /></Field>
        <Field label={t('b.phone')}><input className="input" inputMode="tel" placeholder="+7 7__ ___ __ __" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} autoComplete="tel" /></Field>
        <Field label={t('auth.password')} hint={t('auth.passwordHint')}>
          <input className="input" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" required minLength={8} />
        </Field>
        <ErrorBox error={err} />
        <button className="btn-primary w-full h-12" disabled={busy}>{busy && <Spinner />}{t('auth.submitRegister')}</button>
      </form>
      <p className="text-sm text-muted mt-5 text-center">
        {t('auth.haveAccount')} <Link className="text-ink font-semibold" to={`/login${next ? `?next=${encodeURIComponent(next)}` : ''}`}>{t('auth.login')}</Link>
      </p>
    </Shell>
  )
}
