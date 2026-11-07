import { ArrowDown, ArrowUp, Eye, EyeOff, ImagePlus, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { PageHead } from '../components/PanelLayout'
import { Empty, ErrorBox, Field, Img, Modal, PageLoader, Spinner, Toggle, useAsync } from '../components/ui'
import { api } from '../lib/api'
import { kzt } from '../lib/format'
import type { MenuCategory, MenuItem, Photo } from '../lib/types'
import { usePartner } from './PartnerApp'

type Draft = Partial<MenuItem> & { category_id: number }

export function PartnerMenu() {
  const { rid } = usePartner()
  const base = `/partner/restaurants/${rid}/menu`
  const q = useAsync(() => api.get<MenuCategory[]>(base), [rid])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const run = async (fn: () => Promise<unknown>) => {
    setErr(null)
    try {
      await fn()
      await q.reload()
    } catch (e) {
      setErr(e)
    }
  }
  const addCategory = () => {
    const name = prompt('Название категории')
    if (name) run(() => api.post(`${base}/categories`, { name, sort_order: (q.data?.length ?? 0) + 1 }))
  }
  const renameCategory = (c: MenuCategory) => {
    const name = prompt('Название категории', c.name)
    if (name) run(() => api.patch(`${base}/categories/${c.id}`, { name, sort_order: c.sort_order }))
  }
  const deleteCategory = (c: MenuCategory) => {
    if (confirm(`Удалить категорию «${c.name}» и все блюда в ней?`)) run(() => api.del(`${base}/categories/${c.id}`))
  }
  const toggleHidden = (i: MenuItem) => run(() => api.patch(`${base}/items/${i.id}`, { is_hidden: !i.is_hidden }))
  const deleteItem = (i: MenuItem) => { if (confirm(`Удалить «${i.name}»?`)) run(() => api.del(`${base}/items/${i.id}`)) }

  const saveItem = async () => {
    if (!draft) return
    setBusy(true)
    setErr(null)
    try {
      const body = {
        category_id: draft.category_id, name: draft.name ?? '', description: draft.description ?? '',
        price: Number(draft.price ?? 0), image_url: draft.image_url ?? '', is_hidden: !!draft.is_hidden,
      }
      if (draft.id) await api.patch(`${base}/items/${draft.id}`, body)
      else await api.post(`${base}/items`, body)
      setDraft(null)
      q.reload()
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(false)
    }
  }
  const uploadPhoto = async (file?: File) => {
    if (!file || !draft) return
    setBusy(true)
    try {
      const r = await api.upload(`/partner/restaurants/${rid}/uploads`, file)
      setDraft({ ...draft, image_url: r.url })
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(false)
    }
  }

  if (q.loading && !q.data) return <PageLoader />
  const cats = q.data ?? []
  return (
    <>
      <PageHead title="Меню" sub="Скрытые блюда не видны клиентам" actions={<button className="btn-primary btn-sm" onClick={addCategory}><Plus size={15} />Категория</button>} />
      <ErrorBox error={err ?? q.error} className="mb-3" />
      {cats.length === 0 && <Empty>Добавьте первую категорию меню, например «Горячие блюда»</Empty>}
      <div className="space-y-6">
        {cats.map((c) => (
          <section key={c.id} className="card p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-3">
              <h2 className="font-bold text-lg flex-1">{c.name} <span className="text-muted font-normal text-sm">· {c.items.length}</span></h2>
              <button className="btn-ghost btn-sm" onClick={() => renameCategory(c)} aria-label="Переименовать"><Pencil size={14} /></button>
              <button className="btn-ghost btn-sm" onClick={() => deleteCategory(c)} aria-label="Удалить категорию"><Trash2 size={14} /></button>
              <button className="btn-primary btn-sm" onClick={() => setDraft({ category_id: c.id, price: 0 })}><Plus size={14} />Блюдо</button>
            </div>
            <div className="divide-y divide-line">
              {c.items.map((i) => (
                <div key={i.id} className={`flex items-center gap-3 py-3 ${i.is_hidden ? 'opacity-50' : ''}`}>
                  <Img src={i.image_url} alt={i.name} className="size-14 rounded-xl shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">{i.name}</div>
                    <div className="text-xs text-muted truncate">{i.description}</div>
                  </div>
                  <div className="font-bold whitespace-nowrap">{kzt(i.price)}</div>
                  <button className="size-9 grid place-items-center rounded-full hover:bg-zinc-100" title={i.is_hidden ? 'Показать' : 'Скрыть'} onClick={() => toggleHidden(i)}>
                    {i.is_hidden ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                  <button className="size-9 grid place-items-center rounded-full hover:bg-zinc-100" title="Изменить" onClick={() => setDraft({ ...i })}><Pencil size={15} /></button>
                  <button className="size-9 grid place-items-center rounded-full hover:bg-red-50 text-red-600" title="Удалить" onClick={() => deleteItem(i)}><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <Modal open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'Изменить блюдо' : 'Новое блюдо'}>
        {draft && (
          <div className="space-y-4">
            <Field label="Название"><input className="input" value={draft.name ?? ''} maxLength={120} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
            <Field label="Описание"><textarea className="input" rows={3} maxLength={1000} value={draft.description ?? ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Цена, ₸"><input className="input" type="number" min={0} step={100} value={draft.price ?? 0} onChange={(e) => setDraft({ ...draft, price: +e.target.value })} /></Field>
              <Field label="Категория">
                <select className="input" value={draft.category_id} onChange={(e) => setDraft({ ...draft, category_id: +e.target.value })}>
                  {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Фото">
              <div className="flex items-center gap-3">
                <Img src={draft.image_url ?? ''} alt="" className="size-16 rounded-xl" />
                <label className="btn-ghost btn-sm cursor-pointer">
                  <ImagePlus size={15} />Загрузить
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => uploadPhoto(e.target.files?.[0])} />
                </label>
              </div>
            </Field>
            <Toggle checked={!!draft.is_hidden} onChange={(v) => setDraft({ ...draft, is_hidden: v })} label="Временно скрыть из меню" />
            <ErrorBox error={err} />
            <button className="btn-primary w-full" disabled={busy || !draft.name} onClick={saveItem}>{busy && <Spinner />}Сохранить</button>
          </div>
        )}
      </Modal>
    </>
  )
}

export function PartnerPhotos() {
  const { rid } = usePartner()
  const base = `/partner/restaurants/${rid}`
  const q = useAsync(() => api.get<Photo[]>(`${base}/photos`), [rid])
  const [err, setErr] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    setErr(null)
    try {
      let order = q.data?.length ?? 0
      for (const file of Array.from(files)) {
        const r = await api.upload(`${base}/uploads`, file)
        await api.post(`${base}/photos`, { url: r.url, sort_order: order++ })
      }
      await q.reload()
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(false)
    }
  }
  const remove = async (p: Photo) => {
    if (!confirm('Удалить фото?')) return
    await api.del(`${base}/photos/${p.id}`).catch(setErr)
    q.reload()
  }
  const move = async (idx: number, dir: -1 | 1) => {
    const list = [...(q.data ?? [])]
    const j = idx + dir
    if (j < 0 || j >= list.length) return
    ;[list[idx], list[j]] = [list[j], list[idx]]
    q.setData(list)
    await api.put(`${base}/photos/order`, list.map((p) => p.id)).catch(setErr)
  }

  return (
    <>
      <PageHead title="Фотографии" sub="Интерьер и атмосфера. JPEG, PNG или WEBP до 8 МБ."
        actions={
          <label className="btn-primary btn-sm cursor-pointer">
            {busy ? <Spinner /> : <ImagePlus size={15} />}Загрузить
            <input type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => upload(e.target.files)} />
          </label>
        } />
      <ErrorBox error={err} className="mb-3" />
      {q.loading && !q.data ? <PageLoader /> : !q.data?.length ? <Empty>Фотографий пока нет</Empty> : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {q.data.map((p, i) => (
            <div key={p.id} className="group relative aspect-[4/3] rounded-2xl overflow-hidden border border-line">
              <Img src={p.url} alt="" className="absolute inset-0 size-full" />
              <div className="absolute inset-x-0 bottom-0 p-2 flex gap-1 justify-end bg-gradient-to-t from-black/50 to-transparent">
                <button className="size-8 grid place-items-center rounded-full bg-white/90" onClick={() => move(i, -1)} aria-label="Раньше"><ArrowUp size={14} /></button>
                <button className="size-8 grid place-items-center rounded-full bg-white/90" onClick={() => move(i, 1)} aria-label="Позже"><ArrowDown size={14} /></button>
                <button className="size-8 grid place-items-center rounded-full bg-white/90 text-red-600" onClick={() => remove(p)} aria-label="Удалить"><Trash2 size={14} /></button>
              </div>
              {i === 0 && <span className="absolute top-2 left-2 text-[11px] font-bold bg-white/90 rounded-full px-2 py-0.5">Первое</span>}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
