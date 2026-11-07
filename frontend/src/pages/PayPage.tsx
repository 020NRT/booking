/* Checkout page of the test ("mock") payment provider. A real provider will
   redirect to its own hosted page instead; the booking is confirmed only by
   the provider's server notification in both cases. */
import { CreditCard, ShieldCheck, TimerReset } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { ErrorBox, PageLoader, Spinner, useAsync } from '../components/ui'
import { api } from '../lib/api'
import { fmtDate, fmtTime, kzt } from '../lib/format'
import { useI18n } from '../lib/i18n'
import type { Payment } from '../lib/types'

export default function PayPage() {
  const { id = '' } = useParams()
  const { t, lang } = useI18n()
  const nav = useNavigate()
  const p = useAsync(() => api.get<Payment>(`/payments/${id}`), [id])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [])

  if (p.loading) return <PageLoader />
  if (!p.data) return <div className="mx-auto max-w-md px-4 py-10"><ErrorBox error={p.error} /></div>
  const pay = p.data
  const b = pay.booking
  const left = b.hold_expires_at ? Math.max(0, new Date(b.hold_expires_at).getTime() - now) : 0
  const expired = b.status !== 'pending_payment' || (b.hold_expires_at !== null && left === 0)
  if (pay.status !== 'pending') return <Navigate to={`/bookings/${b.id}`} replace />

  const simulate = async (success: boolean) => {
    setBusy(true)
    setErr(null)
    try {
      await api.post(`/payments/mock/${pay.id}/simulate`, { success })
      nav(`/bookings/${b.id}`, { replace: true })
    } catch (e) {
      setErr(e)
      setBusy(false)
    }
  }

  const mm = String(Math.floor(left / 60000)).padStart(2, '0')
  const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, '0')

  return (
    <div className="mx-auto max-w-md px-4 py-8 sm:py-14">
      <h1 className="text-2xl font-bold tracking-tight">{t('pay.title')}</h1>
      <div className="card mt-5 p-5">
        <div className="text-sm text-muted">{b.restaurant_name}</div>
        <div className="text-sm mt-0.5">{fmtDate(b.starts_at, lang)}, {fmtTime(b.starts_at)} · {t('b.table')} №{b.table_number} · {b.guests} {t('common.persons')}</div>
        <div className="flex items-end justify-between mt-5">
          <span className="text-muted text-sm">{t('pay.amount')}</span>
          <span className="text-3xl font-extrabold">{kzt(pay.amount)}</span>
        </div>
        {!expired && (
          <div className="mt-4 flex items-center gap-2 text-sm text-amber-700 bg-amber-50 rounded-xl px-3 py-2">
            <TimerReset size={16} /> {t('pay.left')}: <b className="tabular-nums">{mm}:{ss}</b>
          </div>
        )}
      </div>

      {expired ? (
        <div className="mt-5">
          <ErrorBox error={t('pay.expired')} />
          <button className="btn-primary w-full mt-4" onClick={() => nav(`/r/${b.restaurant_slug}/book`)}>{t('done.retry')}</button>
        </div>
      ) : (
        <div className="card mt-4 p-5">
          <div className="flex items-center gap-2 text-xs font-semibold text-indigo-700 bg-indigo-50 rounded-lg px-3 py-2">
            <ShieldCheck size={14} /> {t('pay.test')}
          </div>
          <div className="mt-4 rounded-xl border border-line p-4 flex items-center gap-3 text-sm text-muted">
            <CreditCard size={20} /> •••• •••• •••• 4242
          </div>
          <ErrorBox error={err} className="mt-3" />
          <button className="btn-accent w-full h-12 mt-4 text-[15px]" disabled={busy} onClick={() => simulate(true)}>
            {busy && <Spinner />} {t('pay.pay')} {kzt(pay.amount)}
          </button>
          <button className="btn-ghost w-full mt-2" disabled={busy} onClick={() => simulate(false)}>{t('pay.decline')}</button>
        </div>
      )}
    </div>
  )
}
