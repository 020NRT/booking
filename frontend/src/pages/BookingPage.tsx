import { CheckCircle2, Clock3, MapPin, XCircle } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ErrorBox, PageLoader, Spinner, StatusBadge, useAsync } from '../components/ui'
import { api } from '../lib/api'
import { fmtDate, fmtTime, kzt } from '../lib/format'
import { useI18n } from '../lib/i18n'
import type { Booking } from '../lib/types'

export default function BookingPage() {
  const { id = '' } = useParams()
  const { t, lang } = useI18n()
  const nav = useNavigate()
  const q = useAsync(() => api.get<Booking>(`/bookings/${id}`), [id])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)

  if (q.loading && !q.data) return <PageLoader />
  if (!q.data) return <div className="mx-auto max-w-md px-4 py-10"><ErrorBox error={q.error} /></div>
  const b = q.data

  const cancel = async () => {
    if (!confirm(t('done.cancelConfirm'))) return
    setBusy(true)
    try {
      q.setData(await api.post<Booking>(`/bookings/${b.id}/cancel`, {}))
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(false)
    }
  }
  const payNow = async () => {
    setBusy(true)
    try {
      const r = await api.post<{ payment_id: string }>(`/bookings/${b.id}/pay`)
      nav(`/pay/${r.payment_id}`)
    } catch (e) {
      setErr(e)
      setBusy(false)
      q.reload()
    }
  }

  const ok = b.status === 'confirmed' || b.status === 'checked_in' || b.status === 'completed'
  const head = ok
    ? { icon: <CheckCircle2 className="text-emerald-500" size={44} />, title: t('done.confirmed') }
    : b.status === 'pending_payment'
      ? { icon: <Clock3 className="text-amber-500" size={44} />, title: t('done.pending') }
      : { icon: <XCircle className="text-rose-500" size={44} />, title: b.status === 'payment_failed' ? t('done.failed') : t('status.' + b.status as 'status.cancelled') }

  return (
    <div className="mx-auto max-w-md px-4 py-8 sm:py-12 fade-in">
      <div className="text-center">
        <div className="inline-block">{head.icon}</div>
        <h1 className="text-2xl font-bold tracking-tight mt-3">{head.title}</h1>
        {b.cancel_reason && !ok && <p className="text-sm text-muted mt-1">{b.cancel_reason}</p>}
      </div>

      {b.qr_url && (
        <div className="card mt-6 p-6 flex flex-col items-center">
          <div className="p-3 rounded-2xl bg-white border border-line">
            <QRCodeSVG value={b.qr_url} size={208} level="M" marginSize={0} />
          </div>
          <p className="text-sm text-muted mt-4 text-center">{t('done.showQr')}</p>
        </div>
      )}

      <div className="card mt-4 divide-y divide-line">
        <div className="px-4 py-3 flex justify-between items-center">
          <span className="text-sm text-muted">{t('done.number')}</span>
          <span className="font-mono font-bold tracking-wider">{b.code}</span>
        </div>
        <div className="px-4 py-3">
          <Link to={`/r/${b.restaurant_slug}`} className="font-semibold hover:underline">{b.restaurant_name}</Link>
          <div className="text-sm text-muted flex items-center gap-1 mt-0.5"><MapPin size={13} />{b.restaurant_address}</div>
        </div>
        <Row k={t('b.date')} v={`${fmtDate(b.starts_at, lang)}, ${fmtTime(b.starts_at)}`} />
        <Row k={t('b.table')} v={`№${b.table_number} · ${b.hall_name}`} />
        <Row k={t('b.guests')} v={String(b.guests)} />
        {b.deposit_amount > 0 && <Row k={t('r.deposit')} v={kzt(b.deposit_amount)} />}
        <div className="px-4 py-3 flex justify-between items-center"><span className="text-sm text-muted">Статус</span><StatusBadge status={b.status} /></div>
      </div>

      <ErrorBox error={err} className="mt-4" />
      <div className="mt-5 flex flex-col gap-2">
        {b.status === 'pending_payment' && (
          <button className="btn-accent h-12" disabled={busy} onClick={payNow}>{busy && <Spinner />}{t('done.payNow')} {kzt(b.deposit_amount)}</button>
        )}
        {b.status === 'payment_failed' && (
          <Link className="btn-primary h-12" to={`/r/${b.restaurant_slug}/book`}>{t('done.retry')}</Link>
        )}
        {b.can_cancel && <button className="btn-danger" disabled={busy} onClick={cancel}>{t('done.cancel')}</button>}
        <Link to="/me" className="btn-ghost">{t('nav.myBookings')}</Link>
      </div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="px-4 py-3 flex justify-between gap-4 text-sm">
      <span className="text-muted">{k}</span><span className="font-medium text-right">{v}</span>
    </div>
  )
}
