import { Building2, CalendarDays, LayoutDashboard, ShieldCheck, Users, Wallet } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import BookingsTable, { emptyFilters, FiltersBar } from '../components/BookingsTable'
import PanelLayout, { BarChart, PageHead, StatCard } from '../components/PanelLayout'
import { Empty, ErrorBox, Field, Modal, PageLoader, Spinner, StatusBadge, Toggle, useAsync } from '../components/ui'
import { api } from '../lib/api'
import { fmtDateTime, kzt } from '../lib/format'
import type { AdminUser, Booking, Paginated, Restaurant, RestaurantCard, RestaurantStatus, Role } from '../lib/types'

export default function AdminShell() {
  return (
    <PanelLayout
      title="Reserve Admin"
      nav={[
        { to: '/admin', end: true, label: 'Dashboard', icon: <LayoutDashboard size={17} /> },
        { to: '/admin/restaurants', label: 'Рестораны', icon: <Building2 size={17} /> },
        { to: '/admin/customers', label: 'Клиенты', icon: <Users size={17} /> },
        { to: '/admin/admins', label: 'Администраторы', icon: <ShieldCheck size={17} /> },
        { to: '/admin/bookings', label: 'Бронирования', icon: <CalendarDays size={17} /> },
        { to: '/admin/finance', label: 'Финансы', icon: <Wallet size={17} /> },
      ]}
    />
  )
}

interface PStats {
  restaurants: number; restaurants_active: number; customers: number; restaurant_admins: number
  bookings_total: number; bookings_active: number; bookings_cancelled: number
  by_status: Record<string, number>; series: { date: string; bookings: number }[]
}

export function AdminDashboard() {
  const s = useAsync(() => api.get<PStats>('/admin/stats'), [])
  const f = useAsync(() => api.get<Finance>('/admin/finance'), [])
  if (s.loading) return <PageLoader />
  if (!s.data) return <ErrorBox error={s.error} />
  const d = s.data
  return (
    <>
      <PageHead title="Обзор платформы" />
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatCard label="Рестораны" value={d.restaurants} hint={`активных: ${d.restaurants_active}`} accent />
        <StatCard label="Клиенты" value={d.customers} />
        <StatCard label="Всего броней" value={d.bookings_total} />
        <StatCard label="Активные" value={d.bookings_active} />
        <StatCard label="Отменённые" value={d.bookings_cancelled} />
        <StatCard label="Депозиты" value={kzt(f.data?.deposits_total ?? 0)} />
      </div>
      <div className="grid lg:grid-cols-[1fr_320px] gap-4 mt-4">
        <div className="card p-5">
          <h2 className="font-bold mb-5">Новые брони за 30 дней</h2>
          {d.series.length ? <BarChart data={d.series.map((x) => ({ label: x.date.slice(5), value: x.bookings }))} /> : <div className="text-sm text-muted">Пока нет данных</div>}
        </div>
        <div className="card p-5">
          <h2 className="font-bold mb-3">По статусам</h2>
          <div className="space-y-2">
            {Object.entries(d.by_status).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between"><StatusBadge status={k as Booking['status']} /><b>{v}</b></div>
            ))}
            {!Object.keys(d.by_status).length && <div className="text-sm text-muted">Нет бронирований</div>}
          </div>
        </div>
      </div>
    </>
  )
}

// ---------- restaurants ----------

const STATUS_LABEL: Record<RestaurantStatus, string> = { active: 'Активен', hidden: 'Скрыт', inactive: 'Деактивирован' }

export function AdminRestaurants() {
  const q = useAsync(() => api.get<RestaurantCard[]>('/admin/restaurants'), [])
  const admins = useAsync(() => api.get<Paginated<AdminUser>>('/admin/users', { role: 'restaurant_admin', page_size: 200 }), [])
  const [edit, setEdit] = useState<Partial<Restaurant> | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!edit) return
    setBusy(true)
    setErr(null)
    try {
      const body = {
        name: edit.name, slug: edit.slug || undefined, address: edit.address ?? '', district: edit.district ?? '',
        phone: edit.phone ?? '', description: edit.description ?? '', status: edit.status ?? 'active',
        is_featured: !!edit.is_featured, deposit_amount: Number(edit.deposit_amount ?? 5000),
        cuisine: (Array.isArray(edit.cuisine) ? edit.cuisine : String(edit.cuisine ?? '').split(',')).map((s) => s.trim()).filter(Boolean),
      }
      if (edit.id) await api.patch(`/admin/restaurants/${edit.id}`, body)
      else await api.post('/admin/restaurants', body)
      setEdit(null)
      q.reload()
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(false)
    }
  }
  const remove = async (r: RestaurantCard) => {
    if (!confirm(`Удалить «${r.name}»? Если есть бронирования — ресторан можно только деактивировать.`)) return
    setErr(null)
    try {
      await api.del(`/admin/restaurants/${r.id}`)
      q.reload()
    } catch (e) {
      setErr(e)
    }
  }

  return (
    <>
      <PageHead title="Рестораны" actions={<button className="btn-primary btn-sm" onClick={() => setEdit({ status: 'active', deposit_amount: 5000 })}>+ Добавить ресторан</button>} />
      <ErrorBox error={err} className="mb-3" />
      {q.loading ? <PageLoader /> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead><tr><th className="table-th">Ресторан</th><th className="table-th">Адрес</th><th className="table-th">Депозит</th><th className="table-th">Администраторы</th><th className="table-th">Статус</th><th className="table-th" /></tr></thead>
            <tbody>
              {q.data?.map((r) => {
                const a = admins.data?.items.filter((u) => u.restaurant_id === r.id) ?? []
                return (
                  <tr key={r.id}>
                    <td className="table-td"><div className="font-semibold">{r.name}{r.is_featured && <span className="ml-2 text-[11px] text-accent">★ рекоменд.</span>}</div><div className="text-xs text-muted">/{r.slug}</div></td>
                    <td className="table-td">{r.address}<div className="text-xs text-muted">{r.district}</div></td>
                    <td className="table-td whitespace-nowrap">{kzt(r.deposit_amount)}</td>
                    <td className="table-td text-xs">{a.length ? a.map((u) => <div key={u.id}>{u.email}</div>) : <span className="text-muted">не назначен</span>}</td>
                    <td className="table-td"><span className={`text-xs font-semibold rounded-full px-2.5 py-0.5 ${r.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-600'}`}>{STATUS_LABEL[r.status]}</span></td>
                    <td className="table-td text-right whitespace-nowrap">
                      <Link className="btn-ghost btn-sm" to={`/partner/${r.id}`}>Панель</Link>{' '}
                      <button className="btn-ghost btn-sm" onClick={async () => setEdit(await api.get<Restaurant>(`/admin/restaurants/${r.id}`))}>Изменить</button>{' '}
                      <button className="btn-danger btn-sm" onClick={() => remove(r)}>Удалить</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Редактировать ресторан' : 'Новый ресторан'} wide>
        {edit && (
          <div className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Название"><input className="input" value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
              <Field label="Адрес страницы (slug)" hint="латиница, цифры и дефис; пусто — автоматически"><input className="input" value={edit.slug ?? ''} onChange={(e) => setEdit({ ...edit, slug: e.target.value })} /></Field>
              <Field label="Адрес"><input className="input" value={edit.address ?? ''} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></Field>
              <Field label="Район"><input className="input" value={edit.district ?? ''} onChange={(e) => setEdit({ ...edit, district: e.target.value })} /></Field>
              <Field label="Телефон"><input className="input" value={edit.phone ?? ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
              <Field label="Кухня (через запятую)"><input className="input" value={Array.isArray(edit.cuisine) ? edit.cuisine.join(', ') : (edit.cuisine as unknown as string) ?? ''} onChange={(e) => setEdit({ ...edit, cuisine: e.target.value as unknown as string[] })} /></Field>
              <Field label="Депозит, ₸"><input className="input" type="number" min={0} step={500} value={edit.deposit_amount ?? 5000} onChange={(e) => setEdit({ ...edit, deposit_amount: +e.target.value })} /></Field>
              <Field label="Статус">
                <select className="input" value={edit.status ?? 'active'} onChange={(e) => setEdit({ ...edit, status: e.target.value as RestaurantStatus })}>
                  {(Object.keys(STATUS_LABEL) as RestaurantStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Описание"><textarea className="input" rows={3} value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
            <Toggle checked={!!edit.is_featured} onChange={(v) => setEdit({ ...edit, is_featured: v })} label="Показывать в «Рекомендуем»" />
            <ErrorBox error={err} />
            <button className="btn-primary w-full" disabled={busy || !edit.name} onClick={save}>{busy && <Spinner />}Сохранить</button>
          </div>
        )}
      </Modal>
    </>
  )
}

// ---------- users ----------

function useUsers(role: Role) {
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const list = useAsync(() => api.get<Paginated<AdminUser>>('/admin/users', { role, q, page, page_size: 50 }), [role, q, page])
  useEffect(() => setPage(1), [q])
  return { q, setQ, page, setPage, list }
}

export function AdminCustomers() {
  const { q, setQ, list } = useUsers('customer')
  const [detail, setDetail] = useState<{ user: AdminUser; bookings: Booking[] } | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const toggleBlock = async (u: AdminUser) => {
    if (!confirm(u.is_active ? `Заблокировать ${u.name}?` : `Разблокировать ${u.name}?`)) return
    try {
      await api.patch(`/admin/users/${u.id}`, { is_active: !u.is_active })
      list.reload()
      setDetail(null)
    } catch (e) {
      setErr(e)
    }
  }
  return (
    <>
      <PageHead title="Клиенты" sub={list.data ? `Всего: ${list.data.total}` : undefined} />
      <input className="input max-w-sm mb-4" placeholder="Поиск по имени, email, телефону" value={q} onChange={(e) => setQ(e.target.value)} />
      <ErrorBox error={err} className="mb-3" />
      <UsersTable list={list.data?.items} loading={list.loading}
        extra={(u) => (
          <>
            <button className="btn-ghost btn-sm" onClick={async () => setDetail(await api.get(`/admin/users/${u.id}`))}>История</button>{' '}
            <button className={u.is_active ? 'btn-danger btn-sm' : 'btn-ghost btn-sm'} onClick={() => toggleBlock(u)}>{u.is_active ? 'Заблокировать' : 'Разблокировать'}</button>
          </>
        )} />
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.user.name ?? ''} wide>
        {detail && (
          <>
            <div className="text-sm text-muted mb-4">{detail.user.email} · {detail.user.phone} · с {new Date(detail.user.created_at).toLocaleDateString('ru-RU')}</div>
            {detail.bookings.length ? (
              <div className="space-y-2">
                {detail.bookings.map((b) => (
                  <div key={b.id} className="flex items-center justify-between gap-3 text-sm border-b border-line pb-2">
                    <div><b>{b.restaurant_name}</b> · №{b.table_number}<div className="text-xs text-muted">{fmtDateTime(b.starts_at)} · {b.code}</div></div>
                    <StatusBadge status={b.status} />
                  </div>
                ))}
              </div>
            ) : <Empty>Бронирований нет</Empty>}
          </>
        )}
      </Modal>
    </>
  )
}

function UsersTable({ list, loading, extra, showRestaurant = false }: {
  list?: AdminUser[]; loading: boolean; extra: (u: AdminUser) => React.ReactNode; showRestaurant?: boolean
}) {
  if (loading && !list) return <PageLoader />
  if (!list?.length) return <Empty>Пользователей не найдено</Empty>
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[760px]">
        <thead><tr>
          <th className="table-th">Имя</th><th className="table-th">Email</th><th className="table-th">Телефон</th>
          {showRestaurant ? <th className="table-th">Ресторан</th> : <th className="table-th">Броней</th>}
          <th className="table-th">Статус</th><th className="table-th" />
        </tr></thead>
        <tbody>
          {list.map((u) => (
            <tr key={u.id}>
              <td className="table-td font-medium">{u.name}</td>
              <td className="table-td">{u.email ?? '—'}</td>
              <td className="table-td whitespace-nowrap">{u.phone ?? '—'}</td>
              <td className="table-td">{showRestaurant ? (u.restaurant_name ?? <span className="text-muted">—</span>) : u.bookings_count}</td>
              <td className="table-td">{u.is_active ? <span className="text-emerald-700 text-xs font-semibold">Активен</span> : <span className="text-red-600 text-xs font-semibold">Заблокирован</span>}</td>
              <td className="table-td text-right whitespace-nowrap">{extra(u)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function AdminAdmins() {
  const { q, setQ, list } = useUsers('restaurant_admin')
  const rests = useAsync(() => api.get<RestaurantCard[]>('/admin/restaurants'), [])
  const [form, setForm] = useState<{ id?: number; name: string; email: string; phone: string; password: string; restaurant_id: number | '' } | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!form) return
    setBusy(true)
    setErr(null)
    try {
      if (form.id) {
        await api.patch(`/admin/users/${form.id}`, {
          name: form.name, restaurant_id: form.restaurant_id || null, role: 'restaurant_admin', ...(form.password ? { password: form.password } : {}),
        })
      } else {
        await api.post('/admin/users', {
          name: form.name, email: form.email, phone: form.phone || null, password: form.password, role: 'restaurant_admin', restaurant_id: form.restaurant_id || null,
        })
      }
      setForm(null)
      list.reload()
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(false)
    }
  }
  const toggle = async (u: AdminUser) => {
    try {
      await api.patch(`/admin/users/${u.id}`, { is_active: !u.is_active })
      list.reload()
    } catch (e) {
      setErr(e)
    }
  }
  return (
    <>
      <PageHead title="Администраторы ресторанов" actions={
        <button className="btn-primary btn-sm" onClick={() => setForm({ name: '', email: '', phone: '', password: '', restaurant_id: '' })}>+ Создать аккаунт</button>
      } />
      <input className="input max-w-sm mb-4" placeholder="Поиск" value={q} onChange={(e) => setQ(e.target.value)} />
      <ErrorBox error={err} className="mb-3" />
      <UsersTable list={list.data?.items} loading={list.loading} showRestaurant
        extra={(u) => (
          <>
            <button className="btn-ghost btn-sm" onClick={() => setForm({ id: u.id, name: u.name, email: u.email ?? '', phone: u.phone ?? '', password: '', restaurant_id: u.restaurant_id ?? '' })}>Изменить</button>{' '}
            <button className={u.is_active ? 'btn-danger btn-sm' : 'btn-ghost btn-sm'} onClick={() => toggle(u)}>{u.is_active ? 'Заблокировать' : 'Разблокировать'}</button>
          </>
        )} />
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Изменить администратора' : 'Новый администратор ресторана'}>
        {form && (
          <div className="space-y-4">
            <Field label="Имя"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Email (логин)"><input className="input" type="email" disabled={!!form.id} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            {!form.id && <Field label="Телефон"><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>}
            <Field label={form.id ? 'Новый пароль (необязательно)' : 'Пароль'} hint="Минимум 8 символов, буквы и цифры">
              <input className="input" type="text" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </Field>
            <Field label="Ресторан">
              <select className="input" value={form.restaurant_id} onChange={(e) => setForm({ ...form, restaurant_id: e.target.value ? +e.target.value : '' })}>
                <option value="">— выберите —</option>
                {rests.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
            <ErrorBox error={err} />
            <button className="btn-primary w-full" disabled={busy} onClick={save}>{busy && <Spinner />}Сохранить</button>
          </div>
        )}
      </Modal>
    </>
  )
}

export function AdminBookings() {
  const [f, setF] = useState(emptyFilters())
  const [rid, setRid] = useState<number | ''>('')
  const [page, setPage] = useState(1)
  const rests = useAsync(() => api.get<RestaurantCard[]>('/admin/restaurants'), [])
  const q = useAsync(() => api.get<Paginated<Booking>>('/admin/bookings', {
    restaurant_id: rid || undefined, date_from: f.date_from, date_to: f.date_to, status: f.status, q: f.q, page, page_size: 50,
  }), [f, rid, page])
  useEffect(() => setPage(1), [f, rid])
  const pages = q.data ? Math.ceil(q.data.total / q.data.page_size) : 1
  return (
    <>
      <PageHead title="Все бронирования" sub={q.data ? `Найдено: ${q.data.total}` : undefined} actions={
        <select className="input h-10 w-56" value={rid} onChange={(e) => setRid(e.target.value ? +e.target.value : '')}>
          <option value="">Все рестораны</option>
          {rests.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      } />
      <FiltersBar value={f} onChange={setF} withTime={false} />
      {q.loading && !q.data ? <PageLoader /> : q.error ? <ErrorBox error={q.error} /> : <BookingsTable items={q.data!.items} showRestaurant />}
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

interface Finance {
  commission_percent: number; deposits_total: number; successful_payments: number; refunds: number
  refunded_amount: number; failed_payments: number; commission_total: number
  per_restaurant: { restaurant_id: number; restaurant: string; deposits: number; payments: number; refunds: number; refunded_amount: number; commission: number; net: number }[]
}

export function AdminFinance() {
  const q = useAsync(() => api.get<Finance>('/admin/finance'), [])
  if (q.loading) return <PageLoader />
  if (!q.data) return <ErrorBox error={q.error} />
  const d = q.data
  return (
    <>
      <PageHead title="Финансы" sub={`Комиссия платформы: ${d.commission_percent}% от депозитов`} />
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <StatCard label="Сумма депозитов" value={kzt(d.deposits_total)} accent />
        <StatCard label="Успешных платежей" value={d.successful_payments} />
        <StatCard label="Возвратов" value={d.refunds} hint={kzt(d.refunded_amount)} />
        <StatCard label="Неуспешных" value={d.failed_payments} />
        <StatCard label="Комиссия Reserve" value={kzt(d.commission_total)} />
      </div>
      <div className="card overflow-x-auto mt-4">
        <table className="w-full min-w-[700px]">
          <thead><tr><th className="table-th">Ресторан</th><th className="table-th">Депозиты</th><th className="table-th">Платежей</th><th className="table-th">Возвраты</th><th className="table-th">Комиссия</th><th className="table-th">К выплате</th></tr></thead>
          <tbody>
            {d.per_restaurant.map((r) => (
              <tr key={r.restaurant_id}>
                <td className="table-td font-medium">{r.restaurant}</td>
                <td className="table-td">{kzt(r.deposits)}</td>
                <td className="table-td">{r.payments}</td>
                <td className="table-td">{r.refunds} · {kzt(r.refunded_amount)}</td>
                <td className="table-td">{kzt(r.commission)}</td>
                <td className="table-td font-semibold">{kzt(r.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
