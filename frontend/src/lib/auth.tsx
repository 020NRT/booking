import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { api, getToken, setToken, setUnauthorizedHandler } from './api'
import type { Role, User } from './types'

interface AuthCtx {
  user: User | null
  ready: boolean
  login: (identifier: string, password: string) => Promise<User>
  register: (data: { name: string; email?: string; phone?: string; password: string }) => Promise<User>
  logout: () => void
  setUser: (u: User) => void
}

const Ctx = createContext<AuthCtx>(null!)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(logout)
    if (!getToken()) {
      setReady(true)
      return
    }
    api
      .get<User>('/auth/me')
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setReady(true))
  }, [logout])

  const login = useCallback(async (identifier: string, password: string) => {
    const r = await api.post<{ access_token: string; user: User }>('/auth/login', { identifier, password })
    setToken(r.access_token)
    setUser(r.user)
    return r.user
  }, [])

  const register = useCallback(async (data: { name: string; email?: string; phone?: string; password: string }) => {
    const r = await api.post<{ access_token: string; user: User }>('/auth/register', data)
    setToken(r.access_token)
    setUser(r.user)
    return r.user
  }, [])

  const value = useMemo(() => ({ user, ready, login, register, logout, setUser }), [user, ready, login, register, logout])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(Ctx)

/** Client-side guard for UX only; the server enforces roles on every request. */
export function RequireRole({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { user, ready } = useAuth()
  const loc = useLocation()
  if (!ready) return null
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />
  return <>{children}</>
}

export function homeFor(user: User): string {
  if (user.role === 'super_admin') return '/admin'
  if (user.role === 'restaurant_admin') return '/partner'
  return '/'
}
