import { ArrowRight, MapPin, Search, Star } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Empty, ErrorBox, Img, PageLoader, useAsync } from '../components/ui'
import { api } from '../lib/api'
import { kzt } from '../lib/format'
import { useI18n } from '../lib/i18n'
import type { RestaurantCard } from '../lib/types'

export function RestaurantTile({ r, large = false }: { r: RestaurantCard; large?: boolean }) {
  return (
    <Link to={`/r/${r.slug}`} className="group block fade-in">
      <div className={`relative overflow-hidden rounded-2xl ${large ? 'aspect-[4/3] sm:aspect-[16/11]' : 'aspect-[4/3]'}`}>
        <Img src={r.cover_url} alt={r.name} className="absolute inset-0 size-full transition duration-500 group-hover:scale-[1.04]" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/0 to-black/0" />
        {r.rating_count > 0 && (
          <span className="absolute top-3 left-3 inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 h-7 text-xs font-bold">
            <Star size={12} className="text-amber-500" fill="currentColor" /> {r.rating_avg.toFixed(1)}
          </span>
        )}
        <div className="absolute bottom-3 left-3 right-3 text-white">
          <div className="text-lg font-bold leading-tight drop-shadow">{r.name}</div>
          <div className="text-[13px] opacity-90 flex items-center gap-1 mt-0.5"><MapPin size={12} />{r.address || r.district}</div>
        </div>
      </div>
      <div className="flex items-center justify-between mt-2.5 text-[13px] text-muted">
        <span className="truncate">{r.cuisine.join(' · ')}</span>
        {r.average_check ? <span className="shrink-0 ml-2">~{kzt(r.average_check)}</span> : null}
      </div>
    </Link>
  )
}

export default function Home() {
  const { t } = useI18n()
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [cuisine, setCuisine] = useState<string | null>(null)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q), 250)
    return () => clearTimeout(id)
  }, [q])

  const cats = useAsync(() => api.get<{ cuisines: string[]; districts: string[] }>('/categories'), [])
  const list = useAsync(
    () => api.get<RestaurantCard[]>('/restaurants', { q: debounced, cuisine }),
    [debounced, cuisine],
  )
  const all = useAsync(() => api.get<RestaurantCard[]>('/restaurants', { sort: 'popular' }), [])
  const filtering = !!debounced || !!cuisine
  const featured = (all.data ?? []).filter((r) => r.is_featured)
  const popular = all.data ?? []

  return (
    <div>
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-40 -right-32 size-[520px] rounded-full bg-gradient-to-br from-indigo-200/60 via-sky-100/40 to-transparent blur-3xl" />
        <div className="pointer-events-none absolute -bottom-48 -left-40 size-[480px] rounded-full bg-gradient-to-tr from-amber-100/70 via-rose-100/40 to-transparent blur-3xl" />
        <div className="relative mx-auto max-w-6xl px-4 sm:px-6 pt-10 sm:pt-20 pb-10 sm:pb-14">
          <h1 className="text-[40px] leading-[1.05] sm:text-6xl font-extrabold tracking-[-0.035em] whitespace-pre-line max-w-3xl">
            {t('home.title')}
          </h1>
          <p className="mt-4 sm:mt-5 text-base sm:text-lg text-ink-2 max-w-xl">{t('home.subtitle')}</p>
          <div className="mt-7 sm:mt-9 max-w-xl relative">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('home.search')}
              className="input h-14 rounded-2xl pl-11 text-base shadow-[0_8px_30px_-12px_rgba(0,0,0,.15)]"
              aria-label={t('home.search')}
            />
          </div>
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4 max-w-3xl text-sm text-ink-2">
            {[t('home.how1'), t('home.how2'), t('home.how3')].map((s, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="grid place-items-center size-7 rounded-full bg-white border border-line text-xs font-bold">{i + 1}</span>
                {s}
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0 pb-1">
          <button className={`chip ${!cuisine ? 'chip-active' : ''}`} onClick={() => setCuisine(null)}>{t('home.all')}</button>
          {cats.data?.cuisines.map((c) => (
            <button key={c} className={`chip ${cuisine === c ? 'chip-active' : ''}`} onClick={() => setCuisine(cuisine === c ? null : c)}>{c}</button>
          ))}
        </div>

        {filtering ? (
          <section className="mt-8">
            {list.loading ? <PageLoader /> : list.error ? <ErrorBox error={list.error} /> : list.data?.length ? (
              <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
                {list.data.map((r) => <RestaurantTile key={r.id} r={r} />)}
              </div>
            ) : <Empty>{t('home.nothing')}</Empty>}
          </section>
        ) : all.loading ? <PageLoader /> : all.error ? <ErrorBox error={all.error} className="mt-8" /> : (
          <>
            {featured.length > 0 && (
              <section className="mt-10">
                <SectionTitle>{t('home.recommended')}</SectionTitle>
                <div className="grid gap-5 sm:grid-cols-2">
                  {featured.slice(0, 2).map((r) => <RestaurantTile key={r.id} r={r} large />)}
                </div>
              </section>
            )}
            <section className="mt-14">
              <SectionTitle>{t('home.popular')}</SectionTitle>
              <div className="flex gap-4 overflow-x-auto no-scrollbar snap-x -mx-4 px-4 sm:mx-0 sm:px-0">
                {popular.slice(0, 8).map((r) => (
                  <div key={r.id} className="snap-start shrink-0 w-[72%] sm:w-[300px]"><RestaurantTile r={r} /></div>
                ))}
              </div>
            </section>
            <section className="mt-14">
              <SectionTitle>{t('home.allPlaces')}</SectionTitle>
              {popular.length ? (
                <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
                  {[...popular].sort((a, b) => a.name.localeCompare(b.name)).map((r) => <RestaurantTile key={r.id} r={r} />)}
                </div>
              ) : <Empty>{t('home.nothing')}</Empty>}
            </section>
          </>
        )}
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-2xl font-bold tracking-tight mb-5 flex items-center gap-2">
      {children} <ArrowRight size={20} className="text-muted" />
    </h2>
  )
}
