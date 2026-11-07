import { AtSign, Clock, Heart, MapPin, Phone, Wallet } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Empty, ErrorBox, Img, Modal, PageLoader, Stars, useAsync } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { hhmm, kzt, WEEKDAYS, WEEKDAYS_KK } from '../lib/format'
import { useI18n } from '../lib/i18n'
import type { MenuCategory, Restaurant, Review } from '../lib/types'

export default function RestaurantPage() {
  const { slug = '' } = useParams()
  const { t, lang } = useI18n()
  const { user } = useAuth()
  const r = useAsync(() => api.get<Restaurant>(`/restaurants/${slug}`), [slug])
  const menu = useAsync(() => api.get<MenuCategory[]>(`/restaurants/${slug}/menu`), [slug])
  const reviews = useAsync(() => api.get<Review[]>(`/restaurants/${slug}/reviews`), [slug])
  const [fav, setFav] = useState(false)
  const [photo, setPhoto] = useState<string | null>(null)
  const [menuCat, setMenuCat] = useState<number | null>(null)

  useEffect(() => {
    if (!user || !r.data) return
    api.get<{ id: number }[]>('/me/favorites').then((l) => setFav(l.some((x) => x.id === r.data!.id))).catch(() => {})
  }, [user, r.data])

  if (r.loading) return <PageLoader />
  if (r.error || !r.data) return <div className="mx-auto max-w-6xl px-4 py-10"><ErrorBox error={r.error ?? 'Не найдено'} /></div>
  const R = r.data
  const days = lang === 'kk' ? WEEKDAYS_KK : WEEKDAYS
  const todayIdx = (new Date().getDay() + 6) % 7
  const gallery = [R.cover_url, ...R.photos.map((p) => p.url)].filter(Boolean)

  const toggleFav = async () => {
    if (!user) return
    const next = !fav
    setFav(next)
    try {
      if (next) await api.put(`/me/favorites/${R.id}`)
      else await api.del(`/me/favorites/${R.id}`)
    } catch {
      setFav(!next)
    }
  }

  const cats = menu.data ?? []
  const shownCats = menuCat ? cats.filter((c) => c.id === menuCat) : cats

  return (
    <div className="pb-28 sm:pb-0">
      {/* gallery */}
      <div className="mx-auto max-w-6xl sm:px-6 sm:pt-6">
        <div className="grid grid-cols-4 grid-rows-2 gap-2 h-[260px] sm:h-[420px] sm:rounded-3xl overflow-hidden">
          {gallery.slice(0, 5).map((src, i) => (
            <button key={i} onClick={() => setPhoto(src)}
              className={`relative overflow-hidden ${i === 0 ? 'col-span-4 row-span-2 sm:col-span-2' : 'hidden sm:block'}`}>
              <Img src={src} alt={R.name} className="absolute inset-0 size-full hover:scale-[1.03] transition duration-500" />
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 sm:px-6 mt-6 grid lg:grid-cols-[1fr_340px] gap-10">
        <div className="min-w-0">
          <div className="flex items-start gap-4">
            {R.logo_url && <Img src={R.logo_url} alt="" className="size-14 rounded-2xl border border-line shrink-0" />}
            <div className="flex-1 min-w-0">
              <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">{R.name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-2">
                {R.rating_count > 0 && (
                  <span className="inline-flex items-center gap-1.5"><Stars value={R.rating_avg} /> <b>{R.rating_avg.toFixed(1)}</b> <span className="text-muted">· {R.rating_count} {t('r.reviewsCount')}</span></span>
                )}
                <span>{R.cuisine.join(' · ')}</span>
              </div>
            </div>
            {user && (
              <button onClick={toggleFav} aria-label="Избранное" className="size-11 grid place-items-center rounded-full border border-line bg-white hover:border-ink/30">
                <Heart size={18} className={fav ? 'text-rose-500' : ''} fill={fav ? 'currentColor' : 'none'} />
              </button>
            )}
          </div>

          {R.description && <p className="mt-6 text-[15px] leading-relaxed text-ink-2 whitespace-pre-line">{R.description}</p>}

          {/* menu */}
          <section className="mt-12" id="menu">
            <h2 className="text-2xl font-bold tracking-tight mb-4">{t('r.menu')}</h2>
            {menu.loading ? <PageLoader /> : cats.length === 0 ? <Empty>{t('r.noMenu')}</Empty> : (
              <>
                <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0 mb-5">
                  <button className={`chip ${menuCat === null ? 'chip-active' : ''}`} onClick={() => setMenuCat(null)}>{t('home.all')}</button>
                  {cats.map((c) => (
                    <button key={c.id} className={`chip ${menuCat === c.id ? 'chip-active' : ''}`} onClick={() => setMenuCat(c.id)}>{c.name}</button>
                  ))}
                </div>
                {shownCats.map((c) => (
                  <div key={c.id} className="mb-8">
                    <h3 className="font-semibold text-muted text-sm uppercase tracking-wide mb-3">{c.name}</h3>
                    <div className="grid sm:grid-cols-2 gap-3">
                      {c.items.map((i) => (
                        <div key={i.id} className="card p-3 flex gap-3.5">
                          <Img src={i.image_url} alt={i.name} className="size-24 rounded-xl shrink-0" />
                          <div className="min-w-0 flex flex-col">
                            <div className="font-semibold leading-snug">{i.name}</div>
                            <div className="text-[13px] text-muted mt-0.5 line-clamp-2">{i.description}</div>
                            <div className="mt-auto pt-1 font-bold">{kzt(i.price)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}
          </section>

          {/* photos */}
          {R.photos.length > 0 && (
            <section className="mt-12">
              <h2 className="text-2xl font-bold tracking-tight mb-4">{t('r.photos')}</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {R.photos.map((p) => (
                  <button key={p.id} onClick={() => setPhoto(p.url)} className="relative aspect-square overflow-hidden rounded-xl">
                    <Img src={p.url} alt={p.caption || R.name} className="absolute inset-0 size-full hover:scale-[1.04] transition duration-500" />
                  </button>
                ))}
              </div>
            </section>
          )}

          <ReviewsSection slug={slug} reviews={reviews.data ?? []} onPosted={reviews.reload} />
        </div>

        {/* sidebar */}
        <aside className="lg:sticky lg:top-24 h-max space-y-4">
          <div className="card p-5 hidden sm:block">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted flex items-center gap-1.5"><Wallet size={15} />{t('r.deposit')}</span>
              <b>{kzt(R.deposit_amount)}</b>
            </div>
            {R.average_check ? (
              <div className="flex items-center justify-between text-sm mt-2">
                <span className="text-muted">{t('r.avgCheck')}</span><span>{kzt(R.average_check)}</span>
              </div>
            ) : null}
            <Link to={`/r/${R.slug}/book`} className="btn-accent w-full mt-4 h-12 text-[15px]">{t('r.book')}</Link>
          </div>
          <div className="card p-5 text-sm space-y-3">
            <div className="font-semibold">{t('r.contacts')}</div>
            {R.address && <div className="flex gap-2.5 text-ink-2"><MapPin size={16} className="shrink-0 mt-0.5" />{R.city}, {R.address}</div>}
            {R.phone && <a href={`tel:${R.phone.replace(/\s/g, '')}`} className="flex gap-2.5 text-ink-2 hover:text-ink"><Phone size={16} />{R.phone}</a>}
            {R.instagram && (
              <a href={`https://instagram.com/${R.instagram.replace(/^@/, '')}`} target="_blank" rel="noreferrer noopener" className="flex gap-2.5 text-ink-2 hover:text-ink">
                <AtSign size={16} />{R.instagram}
              </a>
            )}
          </div>
          <div className="card p-5 text-sm">
            <div className="font-semibold flex items-center gap-2 mb-3"><Clock size={15} />{t('r.hours')}</div>
            <div className="space-y-1.5">
              {R.hours.map((h) => (
                <div key={h.weekday} className={`flex justify-between ${h.weekday === todayIdx ? 'font-semibold text-ink' : 'text-ink-2'}`}>
                  <span>{days[h.weekday]}</span>
                  <span>{h.is_closed ? t('r.closed') : `${hhmm(h.open_time)} – ${hhmm(h.close_time)}`}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {/* sticky mobile CTA */}
      <div className="sm:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-line p-3 pb-[max(12px,env(safe-area-inset-bottom))] flex items-center gap-3">
        <div className="text-xs text-muted leading-tight">{t('r.deposit')}<div className="text-base font-bold text-ink">{kzt(R.deposit_amount)}</div></div>
        <Link to={`/r/${R.slug}/book`} className="btn-accent flex-1 h-12 text-[15px]">{t('r.book')}</Link>
      </div>

      <Modal open={!!photo} onClose={() => setPhoto(null)} title={R.name} wide>
        {photo && <img src={photo} alt={R.name} className="w-full rounded-2xl" />}
      </Modal>
    </div>
  )
}

function ReviewsSection({ slug, reviews, onPosted }: { slug: string; reviews: Review[]; onPosted: () => void }) {
  const { t } = useI18n()
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [rating, setRating] = useState(5)
  const [text, setText] = useState('')
  const [err, setErr] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    setErr(null)
    try {
      await api.post(`/restaurants/${slug}/reviews`, { rating, text })
      setOpen(false)
      setText('')
      onPosted()
    } catch (e) {
      setErr(e instanceof ApiError ? e : new Error(String(e)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-12">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold tracking-tight">{t('r.reviews')}</h2>
        {user && <button className="btn-ghost btn-sm" onClick={() => setOpen(true)}>{t('r.writeReview')}</button>}
      </div>
      {reviews.length === 0 ? <Empty>{t('r.noReviews')}</Empty> : (
        <div className="space-y-3">
          {reviews.map((rv) => (
            <div key={rv.id} className="card p-4">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{rv.author}</span>
                <Stars value={rv.rating} />
              </div>
              {rv.text && <p className="text-sm text-ink-2 mt-2 whitespace-pre-line">{rv.text}</p>}
              <div className="text-xs text-muted mt-2">{new Date(rv.created_at).toLocaleDateString('ru-RU')}</div>
            </div>
          ))}
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={t('r.writeReview')}>
        <div className="flex gap-1.5 mb-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <button key={i} onClick={() => setRating(i)} className={`size-11 rounded-xl border text-lg ${i <= rating ? 'bg-amber-50 border-amber-300' : 'border-line'}`}>★</button>
          ))}
        </div>
        <textarea className="input" rows={4} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
        <ErrorBox error={err} className="mt-3" />
        <button className="btn-primary w-full mt-4" disabled={busy} onClick={submit}>{t('r.send')}</button>
      </Modal>
    </section>
  )
}
