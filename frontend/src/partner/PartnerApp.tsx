import { CalendarDays, Image as ImageIcon, LayoutDashboard, LayoutGrid, Settings, UtensilsCrossed } from 'lucide-react'
import { createContext, useContext } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import PanelLayout from '../components/PanelLayout'
import { ErrorBox, PageLoader, useAsync } from '../components/ui'
import { api } from '../lib/api'
import type { RestaurantCard } from '../lib/types'

interface Ctx { rid: number; restaurant: RestaurantCard; reloadList: () => void }
const PartnerCtx = createContext<Ctx>(null!)
// eslint-disable-next-line react-refresh/only-export-components
export const usePartner = () => useContext(PartnerCtx)

export function PartnerIndex() {
  const list = useAsync(() => api.get<RestaurantCard[]>('/partner/restaurants'), [])
  if (list.loading) return <PageLoader />
  if (list.error) return <div className="p-8"><ErrorBox error={list.error} /></div>
  if (!list.data?.length) return <div className="p-8 text-muted">Нет назначенных ресторанов. Обратитесь к администратору Reserve.</div>
  return <Navigate to={`/partner/${list.data[0].id}`} replace />
}

export default function PartnerShell() {
  const { rid = '' } = useParams()
  const nav = useNavigate()
  const list = useAsync(() => api.get<RestaurantCard[]>('/partner/restaurants'), [])
  if (list.loading) return <PageLoader />
  const restaurant = list.data?.find((r) => r.id === +rid)
  if (!restaurant) return <div className="p-8"><ErrorBox error={list.error ?? 'Нет доступа к этому ресторану'} /></div>

  const base = `/partner/${rid}`
  const switcher = (list.data?.length ?? 0) > 1 ? (
    <select className="input h-10 text-sm" value={rid} onChange={(e) => nav(`/partner/${e.target.value}`)}>
      {list.data!.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
    </select>
  ) : <div className="px-3 font-bold text-lg leading-tight">{restaurant.name}</div>

  return (
    <PartnerCtx.Provider value={{ rid: +rid, restaurant, reloadList: list.reload }}>
      <PanelLayout
        title="Панель ресторана"
        top={switcher}
        nav={[
          { to: base, end: true, label: 'Dashboard', icon: <LayoutDashboard size={17} /> },
          { to: `${base}/bookings`, label: 'Бронирования', icon: <CalendarDays size={17} /> },
          { to: `${base}/floor`, label: 'Схема зала', icon: <LayoutGrid size={17} /> },
          { to: `${base}/menu`, label: 'Меню', icon: <UtensilsCrossed size={17} /> },
          { to: `${base}/photos`, label: 'Фотографии', icon: <ImageIcon size={17} /> },
          { to: `${base}/settings`, label: 'Настройки', icon: <Settings size={17} /> },
        ]}
      />
    </PartnerCtx.Provider>
  )
}

