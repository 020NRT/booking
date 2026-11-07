import { useState } from 'react'
import { kzt, fmtDateTime, todayISO } from '../lib/format'
import { useI18n } from '../lib/i18n'
import type { Booking, BookingStatus } from '../lib/types'
import { Empty, StatusBadge } from './ui'

export const ALL_STATUSES: BookingStatus[] = [
  'pending_payment', 'confirmed', 'checked_in', 'completed', 'cancelled', 'no_show', 'payment_failed',
]

export interface BookingFilters {
  date_from: string
  date_to: string
  time_from: string
  time_to: string
  status: BookingStatus[]
  q: string
}

export const emptyFilters = (): BookingFilters => ({ date_from: '', date_to: '', time_from: '', time_to: '', status: [], q: '' })

export function FiltersBar({ value, onChange, withTime = true }: { value: BookingFilters; onChange: (f: BookingFilters) => void; withTime?: boolean }) {
  const { t } = useI18n()
  const set = (p: Partial<BookingFilters>) => onChange({ ...value, ...p })
  const quick = (from: string, to: string) => set({ date_from: from, date_to: to })
  return (
    <div className="card p-3 sm:p-4 space-y-3 mb-4">
      <div className="flex flex-wrap gap-2">
        <button className="chip" onClick={() => quick(todayISO(), todayISO())}>Сегодня</button>
        <button className="chip" onClick={() => quick(todayISO(1), todayISO(1))}>Завтра</button>
        <button className="chip" onClick={() => quick(todayISO(), todayISO(6))}>7 дней</button>
        <button className="chip" onClick={() => onChange(emptyFilters())}>Сбросить</button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <input className="input" type="date" value={value.date_from} onChange={(e) => set({ date_from: e.target.value })} aria-label="Дата с" />
        <input className="input" type="date" value={value.date_to} onChange={(e) => set({ date_to: e.target.value })} aria-label="Дата по" />
        {withTime && <input className="input" type="time" value={value.time_from} onChange={(e) => set({ time_from: e.target.value })} aria-label="Время с" />}
        {withTime && <input className="input" type="time" value={value.time_to} onChange={(e) => set({ time_to: e.target.value })} aria-label="Время по" />}
        <input className={`input col-span-2 ${withTime ? '' : 'md:col-span-4'}`} placeholder="Номер брони, имя или телефон" value={value.q} onChange={(e) => set({ q: e.target.value })} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {ALL_STATUSES.map((s) => {
          const on = value.status.includes(s)
          return (
            <button key={s} className={`chip h-8 text-xs ${on ? 'chip-active' : ''}`}
              onClick={() => set({ status: on ? value.status.filter((x) => x !== s) : [...value.status, s] })}>
              {t(`status.${s}`)}
            </button>
          )
        })}
      </div>
    </div>
  )
}

const ACTIONS: Partial<Record<BookingStatus, { to: BookingStatus; label: string; danger?: boolean }[]>> = {
  pending_payment: [{ to: 'confirmed', label: 'Подтвердить' }, { to: 'cancelled', label: 'Отменить', danger: true }],
  confirmed: [
    { to: 'checked_in', label: 'Пришёл' }, { to: 'no_show', label: 'Не пришёл' },
    { to: 'completed', label: 'Завершить' }, { to: 'cancelled', label: 'Отменить', danger: true },
  ],
  checked_in: [{ to: 'completed', label: 'Завершить' }],
}

export default function BookingsTable({ items, showRestaurant = false, onAction }: {
  items: Booking[]
  showRestaurant?: boolean
  onAction?: (b: Booking, to: BookingStatus) => void
}) {
  const [open, setOpen] = useState<number | null>(null)
  if (!items.length) return <Empty>Бронирований не найдено</Empty>
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[860px]">
        <thead>
          <tr>
            <th className="table-th">ID</th>
            {showRestaurant && <th className="table-th">Ресторан</th>}
            <th className="table-th">Клиент</th>
            <th className="table-th">Телефон</th>
            <th className="table-th">Дата и время</th>
            <th className="table-th">Гостей</th>
            <th className="table-th">Столик</th>
            <th className="table-th">Депозит</th>
            <th className="table-th">Статус</th>
            {onAction && <th className="table-th" />}
          </tr>
        </thead>
        <tbody>
          {items.map((b) => {
            const acts = ACTIONS[b.status] ?? []
            return (
              <tr key={b.id} className="hover:bg-zinc-50/70">
                <td className="table-td font-mono text-xs font-semibold">{b.code}</td>
                {showRestaurant && <td className="table-td">{b.restaurant_name}</td>}
                <td className="table-td">
                  <div className="font-medium">{b.contact_name}</div>
                  {b.comment && <div className="text-xs text-muted max-w-[200px] truncate" title={b.comment}>{b.comment}</div>}
                </td>
                <td className="table-td whitespace-nowrap"><a href={`tel:${b.contact_phone}`} className="hover:underline">{b.contact_phone}</a></td>
                <td className="table-td whitespace-nowrap">{fmtDateTime(b.starts_at)}</td>
                <td className="table-td text-center">{b.guests}</td>
                <td className="table-td whitespace-nowrap">№{b.table_number}<div className="text-xs text-muted">{b.hall_name}</div></td>
                <td className="table-td whitespace-nowrap">{kzt(b.deposit_amount)}</td>
                <td className="table-td"><StatusBadge status={b.status} /></td>
                {onAction && (
                  <td className="table-td text-right relative">
                    {acts.length > 0 && (
                      <>
                        <button className="btn-ghost btn-sm" onClick={() => setOpen(open === b.id ? null : b.id)}>Действия</button>
                        {open === b.id && (
                          <div className="absolute right-3 mt-1 z-20 card shadow-xl p-1.5 w-40 text-left">
                            {acts.map((a) => (
                              <button key={a.to} onClick={() => { setOpen(null); onAction(b, a.to) }}
                                className={`w-full text-left px-3 h-9 rounded-lg text-sm hover:bg-zinc-100 ${a.danger ? 'text-red-600' : ''}`}>{a.label}</button>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
