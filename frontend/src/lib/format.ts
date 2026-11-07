export const TZ = 'Asia/Almaty'

export function kzt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return new Intl.NumberFormat('ru-RU').format(n) + ' ₸'
}

export function fmtDate(iso: string, lang = 'ru'): string {
  return new Date(iso).toLocaleDateString(lang === 'kk' ? 'kk-KZ' : 'ru-RU', {
    timeZone: TZ, day: 'numeric', month: 'long', weekday: 'short',
  })
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/** YYYY-MM-DD of "today" in Astana, regardless of the device time zone. */
export function todayISO(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)
}

export const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
export const WEEKDAYS_KK = ['Дс', 'Сс', 'Ср', 'Бс', 'Жм', 'Сн', 'Жс']

export function hhmm(t: string) {
  return t.slice(0, 5)
}

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few
  return many
}
