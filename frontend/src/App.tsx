import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import SiteLayout from './components/SiteLayout'
import { PageLoader } from './components/ui'
import { AuthProvider, RequireRole } from './lib/auth'
import { I18nProvider } from './lib/i18n'
import { LoginPage, RegisterPage } from './pages/AuthPages'
import Home from './pages/Home'
import RestaurantPage from './pages/RestaurantPage'

// Heavier parts (canvas, panels) load on demand to keep the first page fast on phones.
const BookPage = lazy(() => import('./pages/BookPage'))
const PayPage = lazy(() => import('./pages/PayPage'))
const BookingPage = lazy(() => import('./pages/BookingPage'))
const CheckPage = lazy(() => import('./pages/CheckPage'))
const MyPages = lazy(() => import('./pages/MyPages').then((m) => ({ default: m.MeLayout })))
const MyBookings = lazy(() => import('./pages/MyPages').then((m) => ({ default: m.MyBookings })))
const MyFavorites = lazy(() => import('./pages/MyPages').then((m) => ({ default: m.MyFavorites })))
const Profile = lazy(() => import('./pages/MyPages').then((m) => ({ default: m.Profile })))

const PartnerShell = lazy(() => import('./partner/PartnerApp'))
const PartnerIndex = lazy(() => import('./partner/PartnerApp').then((m) => ({ default: m.PartnerIndex })))
const PartnerDashboard = lazy(() => import('./partner/PartnerPages').then((m) => ({ default: m.PartnerDashboard })))
const PartnerBookings = lazy(() => import('./partner/PartnerPages').then((m) => ({ default: m.PartnerBookings })))
const PartnerFloor = lazy(() => import('./partner/PartnerPages').then((m) => ({ default: m.PartnerFloor })))
const PartnerSettings = lazy(() => import('./partner/PartnerPages').then((m) => ({ default: m.PartnerSettings })))
const PartnerMenu = lazy(() => import('./partner/MenuPhotos').then((m) => ({ default: m.PartnerMenu })))
const PartnerPhotos = lazy(() => import('./partner/MenuPhotos').then((m) => ({ default: m.PartnerPhotos })))

const AdminShell = lazy(() => import('./admin/AdminApp'))
const AdminDashboard = lazy(() => import('./admin/AdminApp').then((m) => ({ default: m.AdminDashboard })))
const AdminRestaurants = lazy(() => import('./admin/AdminApp').then((m) => ({ default: m.AdminRestaurants })))
const AdminCustomers = lazy(() => import('./admin/AdminApp').then((m) => ({ default: m.AdminCustomers })))
const AdminAdmins = lazy(() => import('./admin/AdminApp').then((m) => ({ default: m.AdminAdmins })))
const AdminBookings = lazy(() => import('./admin/AdminApp').then((m) => ({ default: m.AdminBookings })))
const AdminFinance = lazy(() => import('./admin/AdminApp').then((m) => ({ default: m.AdminFinance })))

const staff = ['restaurant_admin', 'super_admin'] as const

export default function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route element={<SiteLayout />}>
                <Route index element={<Home />} />
                <Route path="r/:slug" element={<RestaurantPage />} />
                <Route path="r/:slug/book" element={<BookPage />} />
                <Route path="pay/:id" element={<RequireRole><PayPage /></RequireRole>} />
                <Route path="bookings/:id" element={<RequireRole><BookingPage /></RequireRole>} />
                <Route path="me" element={<RequireRole><MyPages /></RequireRole>}>
                  <Route index element={<MyBookings />} />
                  <Route path="favorites" element={<MyFavorites />} />
                  <Route path="profile" element={<Profile />} />
                </Route>
              </Route>
              <Route path="login" element={<LoginPage />} />
              <Route path="register" element={<RegisterPage />} />
              <Route path="check/:token" element={<RequireRole><CheckPage /></RequireRole>} />

              <Route path="partner" element={<RequireRole roles={[...staff]}><PartnerIndex /></RequireRole>} />
              <Route path="partner/:rid" element={<RequireRole roles={[...staff]}><PartnerShell /></RequireRole>}>
                <Route index element={<PartnerDashboard />} />
                <Route path="bookings" element={<PartnerBookings />} />
                <Route path="floor" element={<PartnerFloor />} />
                <Route path="menu" element={<PartnerMenu />} />
                <Route path="photos" element={<PartnerPhotos />} />
                <Route path="settings" element={<PartnerSettings />} />
              </Route>

              <Route path="admin" element={<RequireRole roles={['super_admin']}><AdminShell /></RequireRole>}>
                <Route index element={<AdminDashboard />} />
                <Route path="restaurants" element={<AdminRestaurants />} />
                <Route path="customers" element={<AdminCustomers />} />
                <Route path="admins" element={<AdminAdmins />} />
                <Route path="bookings" element={<AdminBookings />} />
                <Route path="finance" element={<AdminFinance />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </I18nProvider>
  )
}
