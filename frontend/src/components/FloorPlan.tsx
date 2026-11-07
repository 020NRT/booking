/* Interactive floor plan (canvas via Konva). Used by customers to pick a
   table and by the editor preview. Data always comes from the API. */
import type Konva from 'konva'
import { Minus, Plus, Scan } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Circle, Group, Layer, Rect, Stage, Text } from 'react-konva'
import type { Decor, TableAvail, TableT } from '../lib/types'

export const COLORS = {
  free: '#12b886',
  freeFill: '#e6fcf5',
  selected: '#4c6ef5',
  selectedFill: '#4c6ef5',
  booked: '#f08c00',
  bookedFill: '#fff4e6',
  off: '#adb5bd',
  offFill: '#f1f3f5',
  floor: '#fbfaf7',
  grid: '#efede7',
}

export type Visual = 'free' | 'selected' | 'booked' | 'unavailable' | 'neutral'

/** Chair centres relative to the table centre (before rotation). */
export function chairPositions(t: Pick<TableT, 'shape' | 'width' | 'height' | 'seats'>) {
  const out: { x: number; y: number }[] = []
  const n = Math.min(t.seats, 20)
  if (t.shape === 'round') {
    const r = Math.max(t.width, t.height) / 2 + 13
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2
      out.push({ x: Math.cos(a) * r, y: Math.sin(a) * r })
    }
    return out
  }
  const w = t.width, h = t.height
  const ends = n >= 6 && w > h ? 2 : n >= 6 && h > w ? 2 : 0
  const sides = n - ends
  const top = Math.ceil(sides / 2), bottom = sides - top
  const horizontal = w >= h
  const len = horizontal ? w : h
  const place = (count: number, sign: 1 | -1) => {
    for (let i = 0; i < count; i++) {
      const p = -len / 2 + (len / (count + 1)) * (i + 1)
      const off = (horizontal ? h : w) / 2 + 12
      out.push(horizontal ? { x: p, y: sign * off } : { x: sign * off, y: p })
    }
  }
  place(top, -1)
  place(bottom, 1)
  if (ends) {
    const off = (horizontal ? w : h) / 2 + 12
    out.push(horizontal ? { x: -off, y: 0 } : { x: 0, y: -off })
    out.push(horizontal ? { x: off, y: 0 } : { x: 0, y: off })
  }
  return out
}

function palette(v: Visual) {
  switch (v) {
    case 'selected': return { stroke: COLORS.selected, fill: COLORS.selectedFill, text: '#fff', chair: COLORS.selected }
    case 'booked': return { stroke: COLORS.booked, fill: COLORS.bookedFill, text: '#b35c00', chair: '#ffd8a8' }
    case 'unavailable': return { stroke: COLORS.off, fill: COLORS.offFill, text: '#868e96', chair: '#dee2e6' }
    case 'neutral': return { stroke: '#495057', fill: '#fff', text: '#212529', chair: '#ced4da' }
    default: return { stroke: COLORS.free, fill: COLORS.freeFill, text: '#087f5b', chair: '#96f2d7' }
  }
}

export function TableNode({ t, visual, highlight = false }: { t: TableT; visual: Visual; highlight?: boolean }) {
  const p = palette(visual)
  const chairs = chairPositions(t)
  const r = Math.max(t.width, t.height) / 2
  return (
    <>
      {chairs.map((c, i) => (
        <Circle key={i} x={c.x} y={c.y} radius={8} fill={p.chair} />
      ))}
      {t.shape === 'round' ? (
        <Circle radius={r} fill={p.fill} stroke={p.stroke} strokeWidth={highlight ? 4 : 2.5}
          shadowColor="#000" shadowOpacity={visual === 'selected' ? 0.25 : 0.06} shadowBlur={visual === 'selected' ? 14 : 6} shadowOffsetY={2} />
      ) : (
        <Rect x={-t.width / 2} y={-t.height / 2} width={t.width} height={t.height} cornerRadius={10} fill={p.fill}
          stroke={p.stroke} strokeWidth={highlight ? 4 : 2.5}
          shadowColor="#000" shadowOpacity={visual === 'selected' ? 0.25 : 0.06} shadowBlur={visual === 'selected' ? 14 : 6} shadowOffsetY={2} />
      )}
      {/* text counter-rotated so numbers stay upright */}
      <Group rotation={-t.rotation}>
        <Text text={t.number} fontSize={17} fontStyle="bold" fontFamily="Manrope" fill={p.text}
          width={80} x={-40} y={t.is_vip ? -16 : -11} align="center" listening={false} />
        <Text text={`${t.seats} мест${t.is_vip ? ' · VIP' : ''}`} fontSize={10} fontFamily="Manrope" fill={p.text}
          width={90} x={-45} y={t.is_vip ? 3 : 8} align="center" opacity={0.85} listening={false} />
      </Group>
    </>
  )
}

const DECOR_STYLE: Record<string, { fill: string; stroke?: string; text: string }> = {
  wall: { fill: '#343a40', text: '#fff' },
  window: { fill: '#a5d8ff', stroke: '#74c0fc', text: '#1864ab' },
  door: { fill: '#ffe8cc', stroke: '#ffc078', text: '#d9480f' },
  bar: { fill: '#e9ecef', stroke: '#ced4da', text: '#495057' },
  kitchen: { fill: '#f1f3f5', stroke: '#dee2e6', text: '#868e96' },
  stage: { fill: '#f3f0ff', stroke: '#d0bfff', text: '#6741d9' },
  plant: { fill: '#d3f9d8', stroke: '#8ce99a', text: '#2b8a3e' },
  zone: { fill: 'rgba(76,110,245,0.05)', stroke: '#bac8ff', text: '#4263eb' },
  label: { fill: 'rgba(0,0,0,0)', text: '#868e96' },
}

export function DecorNode({ d }: { d: Decor }) {
  const s = DECOR_STYLE[d.kind] ?? DECOR_STYLE.bar
  return (
    <>
      {d.kind === 'plant' ? (
        <Circle x={d.width / 2} y={d.height / 2} radius={Math.min(d.width, d.height) / 2} fill={s.fill} stroke={s.stroke} />
      ) : (
        <Rect width={d.width} height={d.height} fill={s.fill} stroke={s.stroke} strokeWidth={1}
          cornerRadius={d.kind === 'wall' ? 2 : 8} dash={d.kind === 'zone' ? [6, 6] : undefined} />
      )}
      {d.label && d.height >= 14 && (
        <Text text={d.label} width={d.width} height={d.height} align="center" verticalAlign="middle" fontSize={12}
          fontStyle="600" fontFamily="Manrope" fill={s.text} listening={false} />
      )}
      {d.label && d.height < 14 && (
        <Text text={d.label} width={d.width} y={d.height + 4} align="center" fontSize={11} fontFamily="Manrope" fill={s.text} listening={false} />
      )}
    </>
  )
}

export function HallBackground({ width, height }: { width: number; height: number }) {
  const lines = []
  for (let x = 50; x < width; x += 50) lines.push(<Rect key={`x${x}`} x={x} y={0} width={1} height={height} fill={COLORS.grid} />)
  for (let y = 50; y < height; y += 50) lines.push(<Rect key={`y${y}`} x={0} y={y} width={width} height={1} fill={COLORS.grid} />)
  return (
    <>
      <Rect width={width} height={height} fill={COLORS.floor} cornerRadius={18} stroke="#e3e0d8" strokeWidth={2} />
      {lines}
    </>
  )
}

/** Container-sized stage with fit-to-width, wheel/pinch zoom and pan. */
export function useZoomStage(contentW: number, contentH: number) {
  const wrap = useRef<HTMLDivElement>(null)
  const stage = useRef<Konva.Stage>(null)
  const [size, setSize] = useState({ w: 600, h: 400 })
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 })
  const fitScale = Math.min(size.w / (contentW + 40), size.h / (contentH + 40))

  const fit = useCallback(() => {
    const s = Math.min(size.w / (contentW + 40), size.h / (contentH + 40))
    setView({ scale: s, x: (size.w - contentW * s) / 2, y: (size.h - contentH * s) / 2 })
  }, [size, contentW, contentH])

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth
      const h = Math.max(300, Math.min(window.innerHeight * 0.62, (w * contentH) / contentW + 40))
      setSize({ w, h })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [contentW, contentH])

  useEffect(() => { fit() }, [fit])

  const zoomAt = useCallback((factor: number, point?: { x: number; y: number }) => {
    setView((v) => {
      const scale = Math.max(fitScale * 0.6, Math.min(v.scale * factor, Math.max(3, fitScale * 4)))
      const p = point ?? { x: size.w / 2, y: size.h / 2 }
      const mx = (p.x - v.x) / v.scale, my = (p.y - v.y) / v.scale
      return { scale, x: p.x - mx * scale, y: p.y - my * scale }
    })
  }, [fitScale, size])

  const lastDist = useRef(0)
  const handlers = {
    onWheel: (e: Konva.KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault()
      const p = stage.current?.getPointerPosition() ?? undefined
      zoomAt(e.evt.deltaY < 0 ? 1.1 : 1 / 1.1, p)
    },
    onTouchMove: (e: Konva.KonvaEventObject<TouchEvent>) => {
      const [a, b] = [e.evt.touches[0], e.evt.touches[1]]
      if (!a || !b) return
      e.evt.preventDefault()
      stage.current?.stopDrag()
      const rect = stage.current!.container().getBoundingClientRect()
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
      const center = { x: (a.clientX + b.clientX) / 2 - rect.left, y: (a.clientY + b.clientY) / 2 - rect.top }
      if (lastDist.current) zoomAt(dist / lastDist.current, center)
      lastDist.current = dist
    },
    onTouchEnd: () => { lastDist.current = 0 },
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
      if (e.target === stage.current) setView((v) => ({ ...v, x: e.target.x(), y: e.target.y() }))
    },
  }
  return { wrap, stage, size, view, fit, zoomAt, handlers }
}

export function ZoomControls({ onIn, onOut, onFit }: { onIn: () => void; onOut: () => void; onFit: () => void }) {
  const b = 'size-9 grid place-items-center rounded-full bg-white/95 border border-line shadow-sm hover:bg-white'
  return (
    <div className="absolute right-3 top-3 flex flex-col gap-2 z-10">
      <button type="button" className={b} onClick={onIn} aria-label="Приблизить"><Plus size={16} /></button>
      <button type="button" className={b} onClick={onOut} aria-label="Отдалить"><Minus size={16} /></button>
      <button type="button" className={b} onClick={onFit} aria-label="Вписать"><Scan size={15} /></button>
    </div>
  )
}

interface Props {
  width: number
  height: number
  decor: Decor[]
  tables: (TableAvail | TableT)[]
  selectedId?: string | null
  onTableClick?: (t: TableAvail | TableT) => void
}

export default function FloorPlan({ width, height, decor, tables, selectedId, onTableClick }: Props) {
  const { wrap, stage, size, view, fit, zoomAt, handlers } = useZoomStage(width, height)
  const [hover, setHover] = useState<string | null>(null)

  const visualOf = (t: TableAvail | TableT): Visual => {
    if (t.id === selectedId) return 'selected'
    if ('state' in t) return t.state === 'free' ? 'free' : t.state === 'booked' ? 'booked' : 'unavailable'
    return t.is_active ? 'free' : 'unavailable'
  }

  return (
    <div ref={wrap} className="relative w-full overflow-hidden rounded-2xl bg-[#f4f2ec] touch-none select-none" style={{ height: size.h }}>
      <ZoomControls onIn={() => zoomAt(1.25)} onOut={() => zoomAt(0.8)} onFit={fit} />
      <Stage
        ref={stage}
        width={size.w}
        height={size.h}
        scaleX={view.scale}
        scaleY={view.scale}
        x={view.x}
        y={view.y}
        draggable
        {...handlers}
      >
        <Layer>
          <HallBackground width={width} height={height} />
          {decor.map((d) => (
            <Group key={d.id} x={d.x} y={d.y} rotation={d.rotation} listening={false}>
              <DecorNode d={d} />
            </Group>
          ))}
          {tables.map((t) => (
            <Group
              key={t.id}
              x={t.x + t.width / 2}
              y={t.y + t.height / 2}
              rotation={t.rotation}
              onClick={() => onTableClick?.(t)}
              onTap={() => onTableClick?.(t)}
              onMouseEnter={(e) => {
                setHover(t.id)
                const c = e.target.getStage()?.container()
                if (c) c.style.cursor = 'pointer'
              }}
              onMouseLeave={(e) => {
                setHover(null)
                const c = e.target.getStage()?.container()
                if (c) c.style.cursor = 'grab'
              }}
            >
              <TableNode t={t} visual={visualOf(t)} highlight={hover === t.id} />
            </Group>
          ))}
        </Layer>
      </Stage>
    </div>
  )
}

export function Legend({ labels }: { labels: { free: string; selected: string; booked: string; unavailable: string } }) {
  const item = (color: string, fill: string, label: string) => (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-3.5 rounded-[5px] border-2" style={{ borderColor: color, background: fill }} />
      {label}
    </span>
  )
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-2">
      {item(COLORS.free, COLORS.freeFill, labels.free)}
      {item(COLORS.selected, COLORS.selectedFill, labels.selected)}
      {item(COLORS.booked, COLORS.bookedFill, labels.booked)}
      {item(COLORS.off, COLORS.offFill, labels.unavailable)}
    </div>
  )
}
