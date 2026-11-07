/* Opened by restaurant staff when scanning a booking QR code. */
import { BadgeCheck, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { Logo } from '../components/SiteLayout'
import { ErrorBox, PageLoader, Spinner, StatusBadge, useAsync } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { fmtDate, fmtTime } from '../lib/format'
import type { Booking } from '../lib/types'

export default function CheckPage() {
  const { token = '' } = useParams()
  const q = useAsync(() => api.get<Booking>(`/checkin/${token}`), [token])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)

  const checkIn = async () => {
    setBusy(true)
    setErr(null)
    try {
      q.setData(await api.post<Booking>(`/checkin/${token}`))
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(false)
    }
  }

  const b = q.data
  const forbidden = q.error instanceof ApiError && q.error.status === 403
  return (
    <div className="min-h-dvh bg-paper">
      <div className="mx-auto max-w-md px-4 py-6">
        <Logo />
        <h1 className="text-2xl font-bold tracking-tight mt-8">Проверка бронирования</h1>
        {q.loading ? <PageLoader /> : !b ? (
          <div className="card p-6 mt-5 text-center">
            <ShieldAlert className="mx-auto text-rose-500" size={40} />
            <p className="mt-3 font-semibold">{forbidden ? 'Эта бронь относится к другому ресторану' : 'Бронирование не найдено'}</p>
            <ErrorBox error={q.error} className="mt-3 text-left" />
          </div>
        ) : (
          <>
            <div className="card mt-5 divide-y divide-line">
              <div className="px-4 py-4 flex items-center justify-between">
                <span className="font-mono text-lg font-bold tracking-wider">{b.code}</span>
                <StatusBadge status={b.status} />
              </div>
              {[
                ['Клиент', b.contact_name],
                ['Телефон', b.contact_phone],
                ['Ресторан', b.restaurant_name],
                ['Столик', `№${b.table_number} · ${b.hall_name}`],
                ['Дата и время', `${fmtDate(b.starts_at)}, ${fmtTime(b.starts_at)}–${fmtTime(b.ends_at)}`],
                ['Гостей', String(b.guests)],
                ...(b.comment ? [['Комментарий', b.comment]] : []),
              ].map(([k, v]) => (
                <div key={k} className="px-4 py-3 flex justify-between gap-4 text-sm">
                  <span className="text-muted">{k}</span><span className="font-medium text-right">{v}</span>
                </div>
              ))}
            </div>
            <ErrorBox error={err} className="mt-4" />
            {b.status === 'confirmed' && (
              <button className="btn-accent w-full h-14 mt-5 text-base" disabled={busy} onClick={checkIn}>
                {busy ? <Spinner /> : <BadgeCheck size={20} />} Гость пришёл (Check-in)
              </button>
            )}
            {b.status === 'checked_in' && (
              <div className="mt-5 rounded-2xl bg-emerald-50 text-emerald-800 p-4 text-center font-semibold">
                ✓ Гость отмечен{b.checked_in_at ? ` в ${fmtTime(b.checked_in_at)}` : ''}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
