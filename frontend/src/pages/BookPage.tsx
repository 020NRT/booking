import { ArrowLeft, CalendarDays, Check, Clock, Crown, Minus, Plus, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import FloorPlan, { Legend } from '../components/FloorPlan'
import { ErrorBox, Field, PageLoader, Spinner, useAsync } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { fmtDate, kzt, todayISO, WEEKDAYS, WEEKDAYS_KK } from '../lib/format'
import { useI18n } from '../lib/i18n'
import type { Availability, Booking, Restaurant, TableAvail } from '../lib/types'

type Step = 1 | 2 | 3 | 4

export default function BookPage() {
  const { slug = '' } = useParams()
  const { t, lang } = useI18n()
  const { user, ready } = useAuth()
  const nav = useNavigate()
  const rq = useAsync(() => api.get<Restaurant>(`/restaurants/${slug}`), [slug])
  const R = rq.data

  const [step, setStep] = useState<Step>(1)
  const [date, setDate] = useState(todayISO())
  const [time, setTime] = useState<string | null>(null)
  const [guests, setGuests] = useState(2)
  const [hallIdx, setHallIdx] = useState(0)
  const [table, setTable] = useState<TableAvail | null>(null)
  const [contact, setContact] = useState({ name: '', phone: '', email: '', comment: '' })
  const [submitErr, setSubmitErr] = useState<unknown>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (user) setContact((c) => ({ ...c, name: c.name || user.name, phone: c.phone || user.phone || '', email: c.email || user.email || '' }))
  }, [user])

  const slots = useAsync(() => api.get<{ slots: string[]; is_closed: boolean }>(`/restaurants/${slug}/slots`, { date }), [slug, date])
  useEffect(() => {
    if (slots.data && time && !slots.data.slots.includes(time)) setTime(null)
  }, [slots.data, time])

  const [avail, setAvail] = useState<Availability | null>(null)
  const [availErr, setAvailErr] = useState<unknown>(null)
  const loadAvail = useCallback(async () => {
    if (!time) return
    try {
      const a = await api.get<Availability>(`/restaurants/${slug}/availability`, { date, time, guests })
      setAvail(a)
      setAvailErr(null)
      // drop the selection if someone else just took that table
      setTable((cur) => {
        if (!cur) return cur
        const fresh = a.halls.flatMap((h) => h.tables).find((x) => x.id === cur.id)
        return fresh && fresh.state === 'free' ? fresh : null
      })
    } catch (e) {
      setAvailErr(e)
    }
  }, [slug, date, time, guests])

  useEffect(() => {
    setAvail(null)
    loadAvail()
  }, [loadAvail])
  // keep the plan live while the customer is choosing
  useEffect(() => {
    if (step !== 2) return
    const id = setInterval(loadAvail, 15000)
    return () => clearInterval(id)
  }, [step, loadAvail])

  const days = useMemo(() => {
    if (!R) return []
    return Array.from({ length: Math.min(R.max_days_ahead + 1, 21) }, (_, i) => todayISO(i))
  }, [R])

  if (rq.loading || !ready) return <PageLoader />
  if (!R) return <div className="mx-auto max-w-3xl px-4 py-10"><ErrorBox error={rq.error} /></div>

  if (!user) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="text-2xl font-bold">{t('b.loginToBook')}</h1>
        <p className="text-muted mt-2">{R.name}</p>
        <div className="flex gap-3 justify-center mt-6">
          <Link className="btn-primary" to={`/login?next=/r/${slug}/book`}>{t('nav.login')}</Link>
          <Link className="btn-ghost" to={`/register?next=/r/${slug}/book`}>{t('nav.register')}</Link>
        </div>
      </div>
    )
  }

  const halls = avail?.halls ?? []
  const hall = halls[Math.min(hallIdx, halls.length - 1)]
  const wd = lang === 'kk' ? WEEKDAYS_KK : WEEKDAYS

  const canNext =
    (step === 1 && !!time) ||
    (step === 2 && !!table) ||
    (step === 3 && contact.name.trim().length > 0 && contact.phone.replace(/\D/g, '').length >= 11) ||
    step === 4

  const submit = async () => {
    if (!table || !time) return
    setSubmitting(true)
    setSubmitErr(null)
    try {
      const res = await api.post<{ booking: Booking; payment_id: string | null; payment_url: string | null }>('/bookings', {
        restaurant_id: R.id, table_id: table.id, date, time, guests,
        contact_name: contact.name, contact_phone: contact.phone, contact_email: contact.email || null, comment: contact.comment,
      })
      if (res.payment_url) {
        const u = new URL(res.payment_url, window.location.origin)
        if (u.origin === window.location.origin) nav(u.pathname)
        else window.location.href = res.payment_url
      } else nav(`/bookings/${res.booking.id}`)
    } catch (e) {
      setSubmitErr(e)
      setSubmitting(false)
      // table may have been taken: refresh and send the user back to the plan
      await loadAvail()
      if (e instanceof ApiError && e.status === 409) setStep(2)
    }
  }

  const next = () => {
    if (step < 4) setStep((s) => (s + 1) as Step)
    else submit()
  }

  const stepTitles = [t('b.date') + ' · ' + t('b.time'), t('b.chooseTable'), t('b.contacts'), t('b.review')]

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 pt-5 pb-32">
      <div className="flex items-center gap-3">
        <button onClick={() => (step === 1 ? nav(`/r/${slug}`) : setStep((s) => (s - 1) as Step))}
          className="size-10 grid place-items-center rounded-full border border-line bg-white" aria-label={t('b.back')}>
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0">
          <div className="text-xs text-muted truncate">{R.name}</div>
          <h1 className="text-xl font-bold tracking-tight">{stepTitles[step - 1]}</h1>
        </div>
      </div>
      <div className="flex gap-1.5 mt-4">
        {[1, 2, 3, 4].map((i) => <div key={i} className={`h-1 flex-1 rounded-full ${i <= step ? 'bg-ink' : 'bg-zinc-200'}`} />)}
      </div>

      {step === 1 && (
        <div className="mt-6 space-y-7 fade-in">
          <div>
            <div className="label flex items-center gap-1.5"><CalendarDays size={14} />{t('b.date')}</div>
            <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0 pb-1">
              {days.map((d) => {
                const dt = new Date(d + 'T12:00:00')
                const active = d === date
                return (
                  <button key={d} onClick={() => setDate(d)}
                    className={`shrink-0 w-[60px] h-[68px] rounded-2xl border flex flex-col items-center justify-center transition ${active ? 'bg-ink text-white border-ink' : 'bg-white border-line hover:border-ink/30'}`}>
                    <span className={`text-[11px] ${active ? 'text-white/70' : 'text-muted'}`}>{wd[(dt.getDay() + 6) % 7]}</span>
                    <span className="text-lg font-bold">{dt.getDate()}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <div className="label flex items-center gap-1.5"><Users size={14} />{t('b.guests')}</div>
            <div className="inline-flex items-center gap-1 rounded-full border border-line bg-white p-1">
              <button className="size-10 grid place-items-center rounded-full hover:bg-zinc-100" onClick={() => setGuests((g) => Math.max(1, g - 1))} aria-label="−"><Minus size={16} /></button>
              <span className="w-10 text-center text-lg font-bold">{guests}</span>
              <button className="size-10 grid place-items-center rounded-full hover:bg-zinc-100" onClick={() => setGuests((g) => Math.min(20, g + 1))} aria-label="+"><Plus size={16} /></button>
            </div>
          </div>

          <div>
            <div className="label flex items-center gap-1.5"><Clock size={14} />{t('b.time')}</div>
            {slots.loading ? <Spinner /> : slots.data?.slots.length ? (
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                {slots.data.slots.map((s) => (
                  <button key={s} onClick={() => setTime(s)}
                    className={`h-11 rounded-xl border text-sm font-semibold transition ${time === s ? 'bg-ink text-white border-ink' : 'bg-white border-line hover:border-ink/30'}`}>
                    {s}
                  </button>
                ))}
              </div>
            ) : <div className="text-sm text-muted card p-4">{slots.data?.is_closed ? t('r.closed') : t('b.noSlots')}</div>}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="mt-6 fade-in">
          <div className="text-sm text-ink-2 mb-3">
            {fmtDate(date + 'T12:00:00Z', lang)} · {time} · {guests} {t('common.persons')}
          </div>
          {halls.length > 1 && (
            <div className="flex gap-2 mb-3 overflow-x-auto no-scrollbar">
              {halls.map((h, i) => (
                <button key={h.id} className={`chip ${i === hallIdx ? 'chip-active' : ''}`} onClick={() => setHallIdx(i)}>{h.name}</button>
              ))}
            </div>
          )}
          <ErrorBox error={availErr} className="mb-3" />
          {!avail ? <PageLoader /> : hall ? (
            <>
              <FloorPlan
                width={hall.width} height={hall.height} decor={hall.decor} tables={hall.tables}
                selectedId={table?.id}
                onTableClick={(tt) => setTable(tt as TableAvail)}
              />
              <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
                <Legend labels={{ free: t('b.legend.free'), selected: t('b.legend.selected'), booked: t('b.legend.booked'), unavailable: t('b.legend.unavailable') }} />
                <span className="text-xs text-muted">{t('b.zoomHint')}</span>
              </div>
            </>
          ) : <div className="card p-6 text-sm text-muted">Схема зала ещё не настроена</div>}

          {table && (
            <div className="card p-4 mt-4 flex items-center gap-4 fade-in">
              <div className={`size-14 rounded-2xl grid place-items-center text-xl font-extrabold ${table.state === 'free' ? 'bg-accent text-white' : 'bg-zinc-100 text-zinc-500'}`}>
                {table.number}
              </div>
              <div className="flex-1 min-w-0 text-sm">
                <div className="font-semibold flex items-center gap-1.5">
                  {t('b.table')} №{table.number} {table.is_vip && <span className="inline-flex items-center gap-1 text-amber-600 text-xs"><Crown size={12} />VIP</span>}
                </div>
                <div className="text-muted">
                  {table.seats} {t('b.seats')} · {table.state === 'free' ? t('b.legend.free') : table.reason || t(`b.legend.${table.state}`)}
                </div>
              </div>
              {table.state === 'free' && <span className="text-accent"><Check size={22} /></span>}
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="mt-6 space-y-4 fade-in">
          <Field label={t('b.name')}>
            <input className="input" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} autoComplete="name" maxLength={120} />
          </Field>
          <Field label={t('b.phone')}>
            <input className="input" inputMode="tel" placeholder="+7 7__ ___ __ __" value={contact.phone}
              onChange={(e) => setContact({ ...contact, phone: e.target.value })} autoComplete="tel" maxLength={20} />
          </Field>
          <Field label={t('b.email')}>
            <input className="input" type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} autoComplete="email" maxLength={254} />
          </Field>
          <Field label={t('b.comment')}>
            <textarea className="input" rows={3} maxLength={500} value={contact.comment} onChange={(e) => setContact({ ...contact, comment: e.target.value })} />
          </Field>
        </div>
      )}

      {step === 4 && table && (
        <div className="mt-6 fade-in">
          <div className="card divide-y divide-line">
            {[
              [R.name, R.address],
              [t('b.date'), `${fmtDate(date + 'T12:00:00Z', lang)}, ${time}`],
              [t('b.table'), `№${table.number} · ${hall?.name ?? ''}`],
              [t('b.guests'), String(guests)],
              [t('b.name'), contact.name],
              [t('b.phone'), contact.phone],
              ...(contact.comment ? [[t('b.comment'), contact.comment]] : []),
            ].map(([k, v], i) => (
              <div key={i} className="flex justify-between gap-4 px-4 py-3 text-sm">
                <span className="text-muted">{k}</span><span className="text-right font-medium break-words min-w-0">{v}</span>
              </div>
            ))}
            {R.deposit_amount > 0 && (
              <div className="flex justify-between px-4 py-4">
                <span className="font-semibold">{t('r.deposit')}</span><span className="text-lg font-extrabold">{kzt(R.deposit_amount)}</span>
              </div>
            )}
          </div>
          {R.deposit_amount > 0 && <p className="text-xs text-muted mt-3">{t('b.depositNote')}</p>}
        </div>
      )}

      <ErrorBox error={submitErr} className="mt-4" />

      <div className="fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-line">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 py-3 pb-[max(12px,env(safe-area-inset-bottom))] flex items-center gap-3">
          <div className={`text-xs text-muted leading-tight min-w-0 truncate ${step === 4 ? 'hidden sm:block' : ''}`}>
            {time ? `${fmtDate(date + 'T12:00:00Z', lang)}, ${time}` : ''}
            {table && <div className="text-ink font-semibold text-sm">{t('b.table')} №{table.number}</div>}
          </div>
          <button className={`btn-accent ml-auto h-12 px-7 text-[15px] ${step === 4 ? 'max-sm:w-full' : ''}`} disabled={!canNext || submitting || (step === 2 && table?.state !== 'free')} onClick={next}>
            {submitting && <Spinner />}
            {step < 4 ? t('b.continue') : R.deposit_amount > 0 ? `${t('b.toPay')} · ${kzt(R.deposit_amount)}` : t('b.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
