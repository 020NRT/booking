/* Floor-plan constructor for restaurant admins.
   Every table keeps its own id; new tables get a temporary client id and are
   sent with `id: null`, so the server inserts them as new rows. Saving sends
   the whole hall in one request and replaces local state with the server's
   answer (real ids), so nothing can overwrite anything else. */
import type Konva from 'konva'
import {
  Circle as CircleIcon, Copy, DoorOpen, Eye, Flower2, Plus, RectangleHorizontal, Save, Square, Trash2, Type,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Group, Layer, Rect, Stage, Transformer } from 'react-konva'
import FloorPlan, { DecorNode, HallBackground, TableNode, ZoomControls, useZoomStage } from '../components/FloorPlan'
import { ErrorBox, Field, Modal, Spinner, Toggle } from '../components/ui'
import { api } from '../lib/api'
import type { Decor, DecorKind, Hall, TableT } from '../lib/types'

const GRID = 10
const snap = (v: number) => Math.round(v / GRID) * GRID
const tmpId = () => `new-${Math.random().toString(36).slice(2, 10)}`
const isNew = (id: string) => id.startsWith('new-')

type Sel = { kind: 'table' | 'decor'; id: string } | null

const DECOR_PRESETS: { kind: DecorKind; label: string; w: number; h: number; icon: React.ReactNode }[] = [
  { kind: 'wall', label: 'Стена', w: 200, h: 10, icon: <RectangleHorizontal size={15} /> },
  { kind: 'window', label: 'Окно', w: 160, h: 12, icon: <RectangleHorizontal size={15} /> },
  { kind: 'door', label: 'Вход', w: 100, h: 16, icon: <DoorOpen size={15} /> },
  { kind: 'bar', label: 'Бар', w: 220, h: 60, icon: <Square size={15} /> },
  { kind: 'kitchen', label: 'Кухня', w: 200, h: 120, icon: <Square size={15} /> },
  { kind: 'stage', label: 'Сцена', w: 200, h: 100, icon: <Square size={15} /> },
  { kind: 'zone', label: 'Зона', w: 300, h: 200, icon: <Square size={15} /> },
  { kind: 'plant', label: '', w: 40, h: 40, icon: <Flower2 size={15} /> },
  { kind: 'label', label: 'Надпись', w: 140, h: 30, icon: <Type size={15} /> },
]

interface Props {
  restaurantId: number
  hall: Hall
  allNumbers: string[] // numbers used in other halls, for auto-numbering
  onSaved: (h: Hall) => void
  onDirtyChange: (dirty: boolean) => void
}

export default function FloorEditor({ restaurantId, hall, allNumbers, onSaved, onDirtyChange }: Props) {
  const [tables, setTables] = useState<TableT[]>(hall.tables)
  const [decor, setDecor] = useState<Decor[]>(hall.decor ?? [])
  const [meta, setMeta] = useState({ name: hall.name, width: hall.width, height: hall.height })
  const [sel, setSel] = useState<Sel>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [preview, setPreview] = useState(false)

  // reset when switching halls or after the server returns fresh data
  useEffect(() => {
    setTables(hall.tables)
    setDecor(hall.decor ?? [])
    setMeta({ name: hall.name, width: hall.width, height: hall.height })
    setSel(null)
    setDirty(false)
  }, [hall])

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const touch = () => { setDirty(true); setSavedAt(null) }

  const updateTable = useCallback((id: string, patch: Partial<TableT>) => {
    setTables((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)))
    touch()
  }, [])
  const updateDecor = useCallback((id: string, patch: Partial<Decor>) => {
    setDecor((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)))
    touch()
  }, [])

  const nextNumber = () => {
    const used = new Set([...allNumbers, ...tables.map((t) => t.number)])
    let n = 1
    while (used.has(String(n))) n++
    return String(n)
  }

  const { wrap, stage, size, view, fit, zoomAt, handlers } = useZoomStage(meta.width, meta.height)

  // Centre of the visible area; shifted diagonally while that spot is taken,
  // so several new items never land exactly on top of each other.
  const centerInView = () => {
    let x = snap(Math.min(Math.max((size.w / 2 - view.x) / view.scale, 60), meta.width - 140))
    let y = snap(Math.min(Math.max((size.h / 2 - view.y) / view.scale, 60), meta.height - 140))
    const taken = (px: number, py: number) =>
      [...tables, ...decor].some((o) => Math.abs(o.x - px) < 30 && Math.abs(o.y - py) < 30)
    for (let i = 0; i < 20 && taken(x, y); i++) {
      x = Math.min(x + 40, meta.width - 100)
      y = Math.min(y + 40, meta.height - 100)
    }
    return { x, y }
  }

  const addTable = (shape: 'round' | 'rect') => {
    const c = centerInView()
    const t: TableT = {
      id: tmpId(), number: nextNumber(), shape, x: c.x, y: c.y,
      width: shape === 'round' ? 80 : 120, height: 80, rotation: 0, seats: shape === 'round' ? 4 : 4,
      min_guests: 1, is_vip: false, is_active: true,
    }
    // append — never replace existing tables
    setTables((ts) => [...ts, t])
    setSel({ kind: 'table', id: t.id })
    touch()
  }

  const addDecor = (p: (typeof DECOR_PRESETS)[number]) => {
    const c = centerInView()
    const d: Decor = { id: tmpId(), kind: p.kind, x: c.x, y: c.y, width: p.w, height: p.h, rotation: 0, label: p.label }
    setDecor((ds) => [...ds, d])
    setSel({ kind: 'decor', id: d.id })
    touch()
  }

  const removeSelected = useCallback(() => {
    if (!sel) return
    if (sel.kind === 'table') setTables((ts) => ts.filter((t) => t.id !== sel.id))
    else setDecor((ds) => ds.filter((d) => d.id !== sel.id))
    setSel(null)
    touch()
  }, [sel])

  const duplicate = () => {
    if (sel?.kind !== 'table') return
    const src = tables.find((t) => t.id === sel.id)
    if (!src) return
    const t = { ...src, id: tmpId(), number: nextNumber(), x: snap(src.x + 30), y: snap(src.y + 30) }
    setTables((ts) => [...ts, t])
    setSel({ kind: 'table', id: t.id })
    touch()
  }

  // keyboard: Delete removes, arrows nudge
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (!sel || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected() }
      const d = e.shiftKey ? 10 : 1
      const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0
      const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0
      if (dx || dy) {
        e.preventDefault()
        if (sel.kind === 'table') setTables((ts) => ts.map((t) => (t.id === sel.id ? { ...t, x: t.x + dx, y: t.y + dy } : t)))
        else setDecor((ds) => ds.map((x) => (x.id === sel.id ? { ...x, x: x.x + dx, y: x.y + dy } : x)))
        touch()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [sel, removeSelected])

  // transformer follows the selected node
  const tr = useRef<Konva.Transformer>(null)
  const nodes = useRef(new Map<string, Konva.Group>())
  useEffect(() => {
    const node = sel ? nodes.current.get(sel.id) : undefined
    tr.current?.nodes(node ? [node] : [])
    tr.current?.getLayer()?.batchDraw()
  }, [sel, tables, decor])

  const save = async () => {
    setSaving(true)
    setErr(null)
    try {
      const body = {
        name: meta.name, width: meta.width, height: meta.height,
        decor: decor.map((d) => ({ ...d, id: isNew(d.id) ? d.id.replace('new-', 'd-') : d.id })),
        tables: tables.map((t) => ({
          id: isNew(t.id) ? null : t.id, number: t.number, shape: t.shape,
          x: Math.round(t.x), y: Math.round(t.y), width: Math.round(t.width), height: Math.round(t.height),
          rotation: Math.round(t.rotation), seats: t.seats, min_guests: t.min_guests, is_vip: t.is_vip, is_active: t.is_active,
        })),
      }
      const saved = await api.put<Hall>(`/partner/restaurants/${restaurantId}/halls/${hall.id}/layout`, body)
      onSaved(saved)
      setSavedAt(Date.now())
    } catch (e) {
      setErr(e)
    } finally {
      setSaving(false)
    }
  }

  const selTable = sel?.kind === 'table' ? tables.find((t) => t.id === sel.id) : undefined
  const selDecor = sel?.kind === 'decor' ? decor.find((d) => d.id === sel.id) : undefined
  const duplicateNumbers = useMemo(() => {
    const seen = new Map<string, number>()
    tables.forEach((t) => seen.set(t.number, (seen.get(t.number) ?? 0) + 1))
    return new Set([...seen].filter(([n, c]) => c > 1 || allNumbers.includes(n)).map(([n]) => n))
  }, [tables, allNumbers])

  const onTransformEnd = (id: string, kind: 'table' | 'decor', node: Konva.Group) => {
    const sx = node.scaleX(), sy = node.scaleY()
    node.scale({ x: 1, y: 1 })
    if (kind === 'table') {
      const t = tables.find((x) => x.id === id)!
      let w = Math.max(40, snap(t.width * sx)), h = Math.max(40, snap(t.height * sy))
      if (t.shape === 'round') w = h = Math.max(w, h)
      updateTable(id, { width: w, height: h, rotation: Math.round(node.rotation()), x: snap(node.x() - w / 2), y: snap(node.y() - h / 2) })
    } else {
      const d = decor.find((x) => x.id === id)!
      updateDecor(id, {
        width: Math.max(8, snap(d.width * sx)), height: Math.max(8, Math.round(d.height * sy)),
        rotation: Math.round(node.rotation()), x: snap(node.x()), y: snap(node.y()),
      })
    }
  }

  return (
    <div className="grid xl:grid-cols-[1fr_300px] gap-4">
      <div className="min-w-0">
        {/* toolbar */}
        <div className="card p-2 flex flex-wrap items-center gap-1.5 mb-3">
          <button className="btn-primary btn-sm" onClick={() => addTable('round')}><CircleIcon size={15} />Круглый стол</button>
          <button className="btn-primary btn-sm" onClick={() => addTable('rect')}><RectangleHorizontal size={15} />Прямоугольный</button>
          <span className="w-px h-6 bg-line mx-1" />
          <details className="relative">
            <summary className="btn-ghost btn-sm list-none cursor-pointer"><Plus size={15} />Элемент зала</summary>
            <div className="absolute z-20 mt-1 card shadow-xl p-1.5 w-44">
              {DECOR_PRESETS.map((p) => (
                <button key={p.kind} className="w-full flex items-center gap-2 px-2.5 h-9 rounded-lg text-sm hover:bg-zinc-100"
                  onClick={(e) => { addDecor(p); (e.currentTarget.closest('details') as HTMLDetailsElement).open = false }}>
                  {p.icon}{p.label || 'Растение'}
                </button>
              ))}
            </div>
          </details>
          <div className="ml-auto flex items-center gap-1.5">
            <button className="btn-ghost btn-sm" onClick={() => setPreview(true)}><Eye size={15} />Как видит клиент</button>
            <button className="btn-accent btn-sm" disabled={saving || !dirty || duplicateNumbers.size > 0} onClick={save}>
              {saving ? <Spinner /> : <Save size={15} />}Сохранить
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted mb-2 min-h-5">
          {dirty ? <span className="text-amber-600 font-semibold">● Есть несохранённые изменения</span>
            : savedAt ? <span className="text-emerald-600 font-semibold">✓ Сохранено</span> : <span>Все изменения сохранены</span>}
          <span className="hidden sm:inline">Перетаскивайте столы мышью · Delete — удалить · стрелки — сдвиг</span>
        </div>
        <ErrorBox error={err} className="mb-3" />
        {duplicateNumbers.size > 0 && <ErrorBox error={`Повторяются номера столиков: ${[...duplicateNumbers].join(', ')}`} className="mb-3" />}

        <div ref={wrap} className="relative w-full overflow-hidden rounded-2xl bg-[#f4f2ec] touch-none select-none border border-line" style={{ height: size.h }}>
          <ZoomControls onIn={() => zoomAt(1.25)} onOut={() => zoomAt(0.8)} onFit={fit} />
          <Stage
            ref={stage} width={size.w} height={size.h} scaleX={view.scale} scaleY={view.scale} x={view.x} y={view.y}
            draggable {...handlers}
            onMouseDown={(e) => { if (e.target === e.target.getStage() || e.target.name() === 'bg') setSel(null) }}
            onTouchStart={(e) => { if (e.target === e.target.getStage() || e.target.name() === 'bg') setSel(null) }}
          >
            <Layer>
              <Group name="bg"><HallBackground width={meta.width} height={meta.height} /></Group>
              <Rect name="bg" width={meta.width} height={meta.height} fill="transparent" />
              {decor.map((d) => (
                <Group
                  key={d.id}
                  ref={(n) => { if (n) nodes.current.set(d.id, n); else nodes.current.delete(d.id) }}
                  x={d.x} y={d.y} rotation={d.rotation} draggable
                  onMouseDown={() => setSel({ kind: 'decor', id: d.id })}
                  onTap={() => setSel({ kind: 'decor', id: d.id })}
                  onDragEnd={(e) => updateDecor(d.id, { x: snap(e.target.x()), y: snap(e.target.y()) })}
                  onTransformEnd={(e) => onTransformEnd(d.id, "decor", e.currentTarget as Konva.Group)}
                >
                  <DecorNode d={d} />
                </Group>
              ))}
              {tables.map((t) => (
                <Group
                  key={t.id}
                  ref={(n) => { if (n) nodes.current.set(t.id, n); else nodes.current.delete(t.id) }}
                  x={t.x + t.width / 2} y={t.y + t.height / 2} rotation={t.rotation} draggable
                  onMouseDown={() => setSel({ kind: 'table', id: t.id })}
                  onTap={() => setSel({ kind: 'table', id: t.id })}
                  onDragEnd={(e) => updateTable(t.id, { x: snap(e.target.x() - t.width / 2), y: snap(e.target.y() - t.height / 2) })}
                  onTransformEnd={(e) => onTransformEnd(t.id, "table", e.currentTarget as Konva.Group)}
                >
                  <TableNode t={t} visual={sel?.id === t.id ? 'selected' : t.is_active ? 'neutral' : 'unavailable'} />
                </Group>
              ))}
              <Transformer
                ref={tr}
                rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
                rotateAnchorOffset={28}
                keepRatio={selTable?.shape === 'round'}
                enabledAnchors={selTable?.shape === 'round'
                  ? ['top-left', 'top-right', 'bottom-left', 'bottom-right']
                  : ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'middle-left', 'middle-right', 'top-center', 'bottom-center']}
                anchorSize={10} anchorCornerRadius={5} borderStroke="#4c6ef5" anchorStroke="#4c6ef5"
                boundBoxFunc={(oldBox, newBox) => (newBox.width < 20 || newBox.height < 8 ? oldBox : newBox)}
              />
            </Layer>
          </Stage>
        </div>
        <div className="text-xs text-muted mt-2">Столиков в зале: {tables.length} · мест: {tables.reduce((s, t) => s + t.seats, 0)}</div>
      </div>

      {/* inspector */}
      <aside className="space-y-4">
        {selTable ? (
          <div className="card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold">Столик №{selTable.number}</h3>
              {isNew(selTable.id) && <span className="text-[11px] font-semibold text-accent bg-accent-soft rounded-full px-2 py-0.5">новый</span>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Номер"><input className="input" value={selTable.number} maxLength={10}
                onChange={(e) => updateTable(selTable.id, { number: e.target.value.trim() })} /></Field>
              <Field label="Мест"><input className="input" type="number" min={1} max={50} value={selTable.seats}
                onChange={(e) => updateTable(selTable.id, { seats: Math.max(1, Math.min(50, +e.target.value || 1)) })} /></Field>
              <Field label="Форма">
                <select className="input" value={selTable.shape} onChange={(e) => {
                  const shape = e.target.value as 'round' | 'rect'
                  const s = Math.max(selTable.width, selTable.height)
                  updateTable(selTable.id, shape === 'round' ? { shape, width: s, height: s } : { shape })
                }}>
                  <option value="round">Круглый</option>
                  <option value="rect">Прямоугольный</option>
                </select>
              </Field>
              <Field label="Мин. гостей"><input className="input" type="number" min={1} max={selTable.seats} value={selTable.min_guests}
                onChange={(e) => updateTable(selTable.id, { min_guests: Math.max(1, Math.min(selTable.seats, +e.target.value || 1)) })} /></Field>
              <Field label="Ширина"><input className="input" type="number" min={40} max={600} step={10} value={selTable.width}
                onChange={(e) => { const v = Math.max(40, +e.target.value || 40); updateTable(selTable.id, selTable.shape === 'round' ? { width: v, height: v } : { width: v }) }} /></Field>
              <Field label="Глубина"><input className="input" type="number" min={40} max={600} step={10} value={selTable.height} disabled={selTable.shape === 'round'}
                onChange={(e) => updateTable(selTable.id, { height: Math.max(40, +e.target.value || 40) })} /></Field>
              <Field label="Поворот, °"><input className="input" type="number" step={15} value={selTable.rotation}
                onChange={(e) => updateTable(selTable.id, { rotation: ((+e.target.value || 0) % 360) })} /></Field>
            </div>
            <div className="flex flex-col gap-2.5 pt-1">
              <Toggle checked={selTable.is_vip} onChange={(v) => updateTable(selTable.id, { is_vip: v })} label="VIP-столик" />
              <Toggle checked={selTable.is_active} onChange={(v) => updateTable(selTable.id, { is_active: v })} label="Доступен для брони" />
            </div>
            <div className="flex gap-2 pt-2">
              <button className="btn-ghost btn-sm flex-1" onClick={duplicate}><Copy size={14} />Копия</button>
              <button className="btn-danger btn-sm flex-1" onClick={removeSelected}><Trash2 size={14} />Удалить</button>
            </div>
          </div>
        ) : selDecor ? (
          <div className="card p-4 space-y-3">
            <h3 className="font-bold">Элемент зала</h3>
            <Field label="Подпись"><input className="input" value={selDecor.label} maxLength={40} onChange={(e) => updateDecor(selDecor.id, { label: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Ширина"><input className="input" type="number" value={selDecor.width} onChange={(e) => updateDecor(selDecor.id, { width: Math.max(8, +e.target.value || 8) })} /></Field>
              <Field label="Высота"><input className="input" type="number" value={selDecor.height} onChange={(e) => updateDecor(selDecor.id, { height: Math.max(4, +e.target.value || 4) })} /></Field>
            </div>
            <button className="btn-danger btn-sm w-full" onClick={removeSelected}><Trash2 size={14} />Удалить</button>
          </div>
        ) : (
          <div className="card p-4 text-sm text-muted">Выберите столик на схеме, чтобы изменить номер, вместимость, размер или поворот.</div>
        )}

        <div className="card p-4 space-y-3">
          <h3 className="font-bold">Параметры зала</h3>
          <Field label="Название"><input className="input" value={meta.name} maxLength={80} onChange={(e) => { setMeta({ ...meta, name: e.target.value }); touch() }} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Ширина"><input className="input" type="number" min={300} max={5000} step={50} value={meta.width}
              onChange={(e) => { setMeta({ ...meta, width: Math.max(300, Math.min(5000, +e.target.value || 300)) }); touch() }} /></Field>
            <Field label="Глубина"><input className="input" type="number" min={300} max={5000} step={50} value={meta.height}
              onChange={(e) => { setMeta({ ...meta, height: Math.max(300, Math.min(5000, +e.target.value || 300)) }); touch() }} /></Field>
          </div>
        </div>
      </aside>

      <Modal open={preview} onClose={() => setPreview(false)} title="Предпросмотр для клиента" wide>
        <FloorPlan width={meta.width} height={meta.height} decor={decor} tables={tables} />
        <p className="text-xs text-muted mt-3">Так зал увидит клиент (все доступные столики показаны свободными). Не забудьте сохранить изменения.</p>
      </Modal>
    </div>
  )
}
