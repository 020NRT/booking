import { Loader2, Star, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useI18n } from '../lib/i18n'
import type { BookingStatus } from '../lib/types'

export function Spinner({ className = '' }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} size={18} />
}

export function PageLoader() {
  return (
    <div className="flex justify-center py-24 text-muted">
      <Spinner className="size-6" />
    </div>
  )
}

export function ErrorBox({ error, className = '' }: { error: unknown; className?: string }) {
  if (!error) return null
  const msg = error instanceof Error ? error.message : String(error)
  return <div className={`rounded-xl bg-red-50 text-red-700 text-sm px-4 py-3 ${className}`}>{msg}</div>
}

export function Empty({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-3 py-14 px-6 text-center text-muted">
      {icon && <div className="text-ink/30">{icon}</div>}
      <div className="text-sm">{children}</div>
    </div>
  )
}

const STATUS_STYLE: Record<BookingStatus, string> = {
  pending_payment: 'bg-amber-50 text-amber-700 ring-amber-200',
  confirmed: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  checked_in: 'bg-blue-50 text-blue-700 ring-blue-200',
  completed: 'bg-zinc-100 text-zinc-700 ring-zinc-200',
  cancelled: 'bg-zinc-100 text-zinc-500 ring-zinc-200',
  no_show: 'bg-rose-50 text-rose-700 ring-rose-200',
  payment_failed: 'bg-rose-50 text-rose-700 ring-rose-200',
}

export function StatusBadge({ status }: { status: BookingStatus }) {
  const { t } = useI18n()
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset whitespace-nowrap ${STATUS_STYLE[status]}`}>
      {t(`status.${status}`)}
    </span>
  )
}

export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-amber-500">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={size} fill={i <= Math.round(value) ? 'currentColor' : 'none'} strokeWidth={1.8} />
      ))}
    </span>
  )
}

export function Modal({ open, onClose, title, children, wide = false }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-[2px] fade-in" onMouseDown={onClose}>
      <div
        className={`bg-white w-full ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'} rounded-t-3xl sm:rounded-3xl max-h-[92vh] overflow-y-auto shadow-2xl`}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="sticky top-0 bg-white/95 backdrop-blur flex items-center justify-between px-6 pt-5 pb-3 z-10">
          <h3 className="text-lg font-bold">{title}</h3>
          <button className="size-9 grid place-items-center rounded-full hover:bg-zinc-100" onClick={onClose} aria-label="Закрыть">
            <X size={18} />
          </button>
        </div>
        <div className="px-6 pb-6">{children}</div>
      </div>
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted mt-1">{hint}</span>}
    </label>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-10 rounded-full transition ${checked ? 'bg-ink' : 'bg-zinc-300'}`}
      >
        <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
      {label && <span className="text-sm">{label}</span>}
    </label>
  )
}

/** Tiny data-loading hook: { data, error, loading, reload }. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const seq = useRef(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps)
  const reload = useCallback(() => {
    const id = ++seq.current
    setLoading(true)
    setError(null)
    return run()
      .then((d) => { if (id === seq.current) setData(d) })
      .catch((e) => { if (id === seq.current) setError(e) })
      .finally(() => { if (id === seq.current) setLoading(false) })
  }, [run])
  useEffect(() => {
    reload()
  }, [reload])
  return { data, error, loading, reload, setData }
}

export function Img({ src, alt, className = '' }: { src: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    return <div className={`bg-gradient-to-br from-zinc-100 to-zinc-200 ${className}`} aria-label={alt} />
  }
  return <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} className={`object-cover ${className}`} />
}
