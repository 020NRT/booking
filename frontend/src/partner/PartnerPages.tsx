import { ExternalLink, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import BookingsTable, { emptyFilters, FiltersBar } from '../components/BookingsTable'
import { BarChart, PageHead, StatCard } from '../components/PanelLayout'
import { ErrorBox, Field, PageLoader, Spinner, Toggle, useAsync } from '../components/ui'
import { api } from '../lib/api'
import { kzt, WEEKDAYS } from '../lib/format'
import type { Booking, BookingStatus, Hall, Paginated, Restaurant, WorkingHours } from '../lib/types'
import FloorEditor from './FloorEditor'
import { usePartner } from './PartnerApp'

interface Stats {
  total_bookings: number
  today_bookings: number
  active_bookings: number
  cancelled_bookings: number
  visitors: number
  deposits_total: number
  series: { date: string; bookings: number; guests: number; cancelled: number }[]
}

export function PartnerDashboard() {
  const { rid, restaurant } = usePartner()
  const [days, setDays] = useState(30)
  const s = useAsync(() => api.get<Stats>(`/partner/restaurants/${rid}/stats`, { days }), [rid, days])
  const today = useAsync(() => {
    const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(new Date())
    return api.get<Paginated<Booking>>(`/partner/restaurants/${rid}/bookings`, { date_from: d, date_to: d, status: ['confirmed', 'checked_in', 'pending_payment'] })
  }, [rid])
  return (
    <>
      <PageHead title="Dashboard" sub={restaurant.name}
        actions={<Link to={`/r/${restaurant.slug}`} target="_blank" className="btn-ghost btn-sm"><ExternalLink size={14} />Страница ресторана</Link>} />
      {s.loading && !s.data ? <PageLoader /> : s.error ? <ErrorBox error={s.error} /> : s.data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <StatCard label="Брони сегодня" value={s.data.today_bookings} accent />
            <StatCard label="Активные" value={s.data.active_bookings} hint="подтверждённые, предстоящие" />
            <StatCard label="Всего броней" value={s.data.total_bookings} />
            <StatCard label="Отменённые" value={s.data.cancelled_bookings} />
            <StatCard label="Посетители" value={s.data.visitors} hint="пришедшие гости" />
            <StatCard label="Депозиты" value={kzt(s.data.deposits_total)} />
          </div>
          <div className="card p-5 mt-4">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-bold">Брони по дням</h2>
              <div className="flex gap-1">
                {[7, 30, 90].map((d) => <button key={d} className={`chip h-8 text-xs ${days === d ? 'chip-active' : ''}`} onClick={() => setDays(d)}>{d} дн.</button>)}
              </div>
            </div>
            <BarChart data={s.data.series.map((x) => ({ label: x.date.slice(5), value: x.bookings, sub: x.cancelled }))} />
            <div className="flex justify-between text-[11px] text-muted mt-2">
              <span>{s.data.series[0]?.date}</span><span>+7 дней вперёд</span>
            </div>
          </div>
        </>
      )}
      <h2 className="font-bold text-lg mt-8 mb-3">Сегодня</h2>
      {today.data && <BookingsTable items={today.data.items} />}
    </>
  )
}

export function PartnerBookings() {
  const { rid } = usePartner()
  const [f, setF] = useState(emptyFilters())
  const [page, setPage] = useState(1)
  const [err, setErr] = useState<unknown>(null)
  const q = useAsync(() => api.get<Paginated<Booking>>(`/partner/restaurants/${rid}/bookings`, { ...f, page, page_size: 50 }), [rid, f, page])
  useEffect(() => setPage(1), [f])

  const act = async (b: Booking, to: BookingStatus) => {
    let reason = ''
    if (to === 'cancelled') {
      const r = prompt(`Отменить бронь ${b.code}? Укажите причину:`)
      if (r === null) return
      reason = r
    }
    setErr(null)
    try {
      await api.patch(`/partner/restaurants/${rid}/bookings/${b.id}/status`, { status: to, reason })
      q.reload()
    } catch (e) {
      setErr(e)
    }
  }
  const pages = q.data ? Math.ceil(q.data.total / q.data.page_size) : 1
  return (
    <>
      <PageHead title="Бронирования" sub={q.data ? `Найдено: ${q.data.total}` : undefined} />
      <FiltersBar value={f} onChange={setF} />
      <ErrorBox error={err} className="mb-3" />
      {q.loading && !q.data ? <PageLoader /> : q.error ? <ErrorBox error={q.error} /> : <BookingsTable items={q.data!.items} onAction={act} />}
      {pages > 1 && (
        <div className="flex gap-2 justify-center mt-4">
          <button className="btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Назад</button>
          <span className="text-sm self-center">{page} / {pages}</span>
          <button className="btn-ghost btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Далее</button>
        </div>
      )}
    </>
  )
}

export function PartnerFloor() {
  const { rid } = usePartner()
  const halls = useAsync(() => api.get<Hall[]>(`/partner/restaurants/${rid}/halls`), [rid])
  const [active, setActive] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const onDirty = useCallback((d: boolean) => setDirty(d), [])

  if (halls.loading && !halls.data) return <PageLoader />
  if (halls.error) return <ErrorBox error={halls.error} />
  const list = halls.data ?? []
  const hall = list[Math.min(active, list.length - 1)]

  const switchTo = (i: number) => {
    if (dirty && !confirm('Есть несохранённые изменения. Перейти без сохранения?')) return
    setActive(i)
  }
  const addHall = async () => {
    const name = prompt('Название зала', `Зал ${list.length + 1}`)
    if (!name) return
    try {
      await api.post(`/partner/restaurants/${rid}/halls`, { name, sort_order: list.length + 1 })
      await halls.reload()
      setActive(list.length)
    } catch (e) {
      setErr(e)
    }
  }
  const deleteHall = async () => {
    if (!hall || !confirm(`Удалить зал «${hall.name}»?`)) return
    setErr(null)
    try {
      await api.del(`/partner/restaurants/${rid}/halls/${hall.id}`)
      setActive(0)
      halls.reload()
    } catch (e) {
      setErr(e)
    }
  }
  const otherNumbers = list.filter((h) => h.id !== hall?.id).flatMap((h) => h.tables.map((t) => t.number))

  return (
    <>
      <PageHead title="Конструктор зала" sub="Изменения после сохранения сразу видны клиентам" actions={
        <>
          <button className="btn-ghost btn-sm" onClick={addHall}><Plus size={15} />Добавить зал</button>
          {hall && <button className="btn-danger btn-sm" onClick={deleteHall}><Trash2 size={14} />Удалить зал</button>}
        </>
      } />
      <ErrorBox error={err} className="mb-3" />
      {list.length > 1 && (
        <div className="flex gap-2 mb-4 overflow-x-auto no-scrollbar">
          {list.map((h, i) => <button key={h.id} className={`chip ${i === active ? 'chip-active' : ''}`} onClick={() => switchTo(i)}>{h.name} · {h.tables.length}</button>)}
        </div>
      )}
      {hall ? (
        <FloorEditor
          key={hall.id}
          restaurantId={rid}
          hall={hall}
          allNumbers={otherNumbers}
          onDirtyChange={onDirty}
          onSaved={(h) => halls.setData(list.map((x) => (x.id === h.id ? h : x)))}
        />
      ) : (
        <div className="card p-8 text-center">
          <p className="text-muted">Залов пока нет.</p>
          <button className="btn-primary mt-4" onClick={addHall}><Plus size={15} />Создать первый зал</button>
        </div>
      )}
    </>
  )
}

export function PartnerSettings() {
  const { rid, reloadList } = usePartner()
  const q = useAsync(() => api.get<Restaurant>(`/partner/restaurants/${rid}`), [rid])
  const [f, setF] = useState<Partial<Restaurant>>({})
  const [hours, setHours] = useState<WorkingHours[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (q.data) {
      setF(q.data)
      setHours(q.data.hours.map((h) => ({ ...h, open_time: h.open_time.slice(0, 5), close_time: h.close_time.slice(0, 5) })))
    }
  }, [q.data])
  if (q.loading || !q.data) return q.error ? <ErrorBox error={q.error} /> : <PageLoader />

  const save = async () => {
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      await api.patch(`/partner/restaurants/${rid}`, {
        name: f.name, description: f.description, address: f.address, district: f.district, phone: f.phone,
        instagram: f.instagram, cuisine: (typeof f.cuisine === 'string' ? (f.cuisine as string).split(',') : f.cuisine ?? []).map((s) => s.trim()).filter(Boolean),
        average_check: f.average_check || null, deposit_amount: Number(f.deposit_amount), booking_duration_min: Number(f.booking_duration_min),
        slot_step_min: Number(f.slot_step_min), cancel_deadline_hours: Number(f.cancel_deadline_hours), max_days_ahead: Number(f.max_days_ahead),
        logo_url: f.logo_url, cover_url: f.cover_url,
      })
      await api.put(`/partner/restaurants/${rid}/hours`, hours)
      setMsg('Сохранено')
      q.reload()
      reloadList()
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(false)
    }
  }
  const upload = async (field: 'logo_url' | 'cover_url', file?: File) => {
    if (!file) return
    try {
      const r = await api.upload(`/partner/restaurants/${rid}/uploads`, file)
      setF((x) => ({ ...x, [field]: r.url }))
    } catch (e) {
      setErr(e)
    }
  }
  const inp = (k: keyof Restaurant, type = 'text', extra: Record<string, unknown> = {}) => (
    <input className="input" type={type} value={(f[k] as string | number | undefined) ?? ''} {...extra}
      onChange={(e) => setF({ ...f, [k]: type === 'number' ? (e.target.value === '' ? '' : +e.target.value) : e.target.value })} />
  )

  return (
    <>
      <PageHead title="Настройки ресторана" actions={<button className="btn-accent" disabled={busy} onClick={save}>{busy && <Spinner />}Сохранить</button>} />
      <ErrorBox error={err} className="mb-3" />
      {msg && <div className="mb-3 rounded-xl bg-emerald-50 text-emerald-700 text-sm px-4 py-3">{msg}</div>}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card p-5 space-y-4">
          <h2 className="font-bold">Информация</h2>
          <Field label="Название">{inp('name')}</Field>
          <Field label="Описание"><textarea className="input" rows={4} value={f.description ?? ''} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Field label="Кухня (через запятую)">
            <input className="input" value={Array.isArray(f.cuisine) ? f.cuisine.join(', ') : (f.cuisine as unknown as string) ?? ''}
              onChange={(e) => setF({ ...f, cuisine: e.target.value as unknown as string[] })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Адрес">{inp('address')}</Field>
            <Field label="Район">{inp('district')}</Field>
            <Field label="Телефон">{inp('phone')}</Field>
            <Field label="Instagram">{inp('instagram')}</Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Логотип">
              <input className="input py-2" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => upload('logo_url', e.target.files?.[0])} />
              {f.logo_url && <img src={f.logo_url} alt="" className="mt-2 size-14 rounded-xl object-cover border border-line" />}
            </Field>
            <Field label="Обложка">
              <input className="input py-2" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => upload('cover_url', e.target.files?.[0])} />
              {f.cover_url && <img src={f.cover_url} alt="" className="mt-2 h-14 w-24 rounded-xl object-cover border border-line" />}
            </Field>
          </div>
        </div>
        <div className="space-y-4">
          <div className="card p-5 space-y-4">
            <h2 className="font-bold">Правила бронирования</h2>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Депозит, ₸" hint="0 — бронь без оплаты">{inp('deposit_amount', 'number', { min: 0, step: 500 })}</Field>
              <Field label="Средний чек, ₸">{inp('average_check', 'number', { min: 0, step: 500 })}</Field>
              <Field label="Длительность брони, мин">{inp('booking_duration_min', 'number', { min: 30, step: 15 })}</Field>
              <Field label="Шаг слотов, мин">{inp('slot_step_min', 'number', { min: 15, step: 15 })}</Field>
              <Field label="Отмена клиентом не позднее, ч">{inp('cancel_deadline_hours', 'number', { min: 0 })}</Field>
              <Field label="Бронь вперёд, дней">{inp('max_days_ahead', 'number', { min: 1 })}</Field>
            </div>
          </div>
          <div className="card p-5">
            <h2 className="font-bold mb-3">График работы</h2>
            <div className="space-y-2">
              {hours.map((h, i) => (
                <div key={h.weekday} className="flex items-center gap-2.5">
                  <span className="w-7 text-sm font-semibold">{WEEKDAYS[h.weekday]}</span>
                  <Toggle checked={!h.is_closed} onChange={(v) => setHours(hours.map((x, j) => (j === i ? { ...x, is_closed: !v } : x)))} />
                  <input className="input h-9 w-28" type="time" disabled={h.is_closed} value={h.open_time}
                    onChange={(e) => setHours(hours.map((x, j) => (j === i ? { ...x, open_time: e.target.value } : x)))} />
                  <span className="text-muted">–</span>
                  <input className="input h-9 w-28" type="time" disabled={h.is_closed} value={h.close_time}
                    onChange={(e) => setHours(hours.map((x, j) => (j === i ? { ...x, close_time: e.target.value } : x)))} />
                </div>
              ))}
            </div>
            <p className="text-xs text-muted mt-3">Закрытие раньше открытия означает работу после полуночи. Последняя посадка — за час до закрытия.</p>
          </div>
        </div>
      </div>
    </>
  )
}
