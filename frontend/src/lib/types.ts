export type Role = 'customer' | 'restaurant_admin' | 'super_admin'

export interface User {
  id: number
  name: string
  email: string | null
  phone: string | null
  role: Role
  restaurant_id: number | null
  is_active: boolean
  language: string
  created_at: string
}

export interface WorkingHours {
  weekday: number
  is_closed: boolean
  open_time: string
  close_time: string
}

export interface Photo {
  id: number
  url: string
  caption: string
  sort_order: number
}

export type RestaurantStatus = 'active' | 'hidden' | 'inactive'

export interface RestaurantCard {
  id: number
  slug: string
  name: string
  description: string
  cuisine: string[]
  address: string
  district: string
  cover_url: string
  logo_url: string
  average_check: number | null
  rating_avg: number
  rating_count: number
  is_featured: boolean
  deposit_amount: number
  status: RestaurantStatus
}

export interface Restaurant extends RestaurantCard {
  city: string
  phone: string
  instagram: string
  timezone: string
  booking_duration_min: number
  slot_step_min: number
  cancel_deadline_hours: number
  max_days_ahead: number
  hours: WorkingHours[]
  photos: Photo[]
}

export interface MenuItem {
  id: number
  category_id: number
  name: string
  description: string
  price: number
  image_url: string
  is_hidden: boolean
  sort_order: number
}

export interface MenuCategory {
  id: number
  name: string
  sort_order: number
  items: MenuItem[]
}

export interface Review {
  id: number
  rating: number
  text: string
  created_at: string
  author: string
}

export type TableShape = 'round' | 'rect'

export interface TableT {
  id: string
  hall_id?: number
  number: string
  shape: TableShape
  x: number
  y: number
  width: number
  height: number
  rotation: number
  seats: number
  min_guests: number
  is_vip: boolean
  is_active: boolean
}

export type TableState = 'free' | 'booked' | 'unavailable'

export interface TableAvail extends TableT {
  state: TableState
  reason: string
}

export type DecorKind = 'wall' | 'window' | 'door' | 'bar' | 'kitchen' | 'stage' | 'plant' | 'label' | 'zone'

export interface Decor {
  id: string
  kind: DecorKind
  x: number
  y: number
  width: number
  height: number
  rotation: number
  label: string
}

export interface Hall {
  id: number
  name: string
  width: number
  height: number
  sort_order?: number
  decor: Decor[]
  tables: TableT[]
}

export interface HallAvail extends Omit<Hall, 'tables'> {
  tables: TableAvail[]
}

export interface Availability {
  date: string
  time: string
  guests: number
  starts_at: string
  ends_at: string
  halls: HallAvail[]
}

export type BookingStatus =
  | 'pending_payment'
  | 'confirmed'
  | 'cancelled'
  | 'checked_in'
  | 'completed'
  | 'no_show'
  | 'payment_failed'

export interface Booking {
  id: number
  code: string
  restaurant_id: number
  restaurant_name: string
  restaurant_slug: string
  restaurant_address: string
  table_id: string
  table_number: string
  hall_name: string
  starts_at: string
  ends_at: string
  guests: number
  contact_name: string
  contact_phone: string
  contact_email: string
  comment: string
  deposit_amount: number
  status: BookingStatus
  hold_expires_at: string | null
  checked_in_at: string | null
  cancelled_at: string | null
  cancel_reason: string
  created_at: string
  can_cancel: boolean
  qr_url?: string | null
}

export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

export interface Payment {
  id: string
  provider: string
  amount: number
  currency: string
  status: 'pending' | 'succeeded' | 'failed' | 'refund_pending' | 'refunded'
  failure_reason: string
  paid_at: string | null
  created_at: string
  booking: Booking
}

export interface AdminUser extends User {
  restaurant_name: string | null
  bookings_count: number
}
