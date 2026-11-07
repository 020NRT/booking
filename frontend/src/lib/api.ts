const TOKEN_KEY = 'reserve.token'

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* storage unavailable (private mode) — session lasts until reload */
  }
}

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, message: string, code = '') {
    super(message)
    this.status = status
    this.code = code
  }
}

type Query = Record<string, string | number | boolean | null | undefined | (string | number)[]>

function qs(params?: Query) {
  if (!params) return ''
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v)) v.forEach((x) => u.append(k, String(x)))
    else u.append(k, String(v))
  }
  const s = u.toString()
  return s ? `?${s}` : ''
}

let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

async function request<T>(method: string, path: string, body?: unknown, params?: Query): Promise<T> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  let payload: BodyInit | undefined
  if (body instanceof FormData) payload = body
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  let res: Response
  try {
    res = await fetch(`/api${path}${qs(params)}`, { method, headers, body: payload })
  } catch {
    throw new ApiError(0, 'Нет соединения с сервером')
  }
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const d = data?.detail
    const message = typeof d === 'string' ? d : d?.message ?? 'Ошибка запроса'
    if (res.status === 401 && token) onUnauthorized?.()
    throw new ApiError(res.status, message, typeof d === 'object' ? d?.code ?? '' : '')
  }
  return data as T
}

export const api = {
  get: <T>(path: string, params?: Query) => request<T>('GET', path, undefined, params),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T = void>(path: string) => request<T>('DELETE', path),
  upload: (path: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return request<{ url: string }>('POST', path, fd)
  },
}
