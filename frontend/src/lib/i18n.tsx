/* Interface strings. To add English: add an `en` block with the same keys
   and list it in LANGS — no other code changes are needed. */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

const ru = {
  'nav.restaurants': 'Рестораны',
  'nav.myBookings': 'Мои брони',
  'nav.login': 'Войти',
  'nav.register': 'Регистрация',
  'nav.logout': 'Выйти',
  'nav.profile': 'Профиль',
  'nav.partner': 'Панель ресторана',
  'nav.admin': 'Админ-панель',

  'home.title': 'Лучший столик —\nв пару касаний',
  'home.subtitle': 'Выберите ресторан в Астане, посмотрите зал и забронируйте конкретный столик онлайн.',
  'home.search': 'Ресторан, кухня или адрес',
  'home.all': 'Все',
  'home.popular': 'Популярные',
  'home.recommended': 'Рекомендуем',
  'home.allPlaces': 'Все заведения',
  'home.nothing': 'Ничего не найдено. Попробуйте другой запрос.',
  'home.how1': 'Выберите дату и время',
  'home.how2': 'Укажите столик на схеме зала',
  'home.how3': 'Внесите депозит — получите QR',

  'r.book': 'Забронировать столик',
  'r.about': 'О ресторане',
  'r.menu': 'Меню',
  'r.photos': 'Фото',
  'r.reviews': 'Отзывы',
  'r.hours': 'График работы',
  'r.contacts': 'Контакты',
  'r.closed': 'Выходной',
  'r.avgCheck': 'Средний чек',
  'r.deposit': 'Депозит',
  'r.noReviews': 'Отзывов пока нет',
  'r.reviewsCount': 'отзывов',
  'r.writeReview': 'Оставить отзыв',
  'r.send': 'Отправить',
  'r.noMenu': 'Меню скоро появится',

  'b.title': 'Бронирование',
  'b.date': 'Дата',
  'b.time': 'Время',
  'b.guests': 'Гостей',
  'b.chooseTable': 'Выберите столик',
  'b.noSlots': 'На эту дату нет свободного времени',
  'b.legend.free': 'Свободен',
  'b.legend.selected': 'Выбран',
  'b.legend.booked': 'Забронирован',
  'b.legend.unavailable': 'Недоступен',
  'b.table': 'Столик',
  'b.seats': 'мест',
  'b.select': 'Выбрать',
  'b.selected': 'Выбран',
  'b.contacts': 'Контактные данные',
  'b.name': 'Имя',
  'b.phone': 'Телефон',
  'b.email': 'Email для подтверждения',
  'b.comment': 'Пожелания (необязательно)',
  'b.review': 'Проверьте бронь',
  'b.continue': 'Продолжить',
  'b.back': 'Назад',
  'b.toPay': 'Перейти к оплате',
  'b.confirm': 'Подтвердить бронь',
  'b.depositNote': 'Депозит засчитывается в счёт. Неоплаченная бронь снимается через 10 минут.',
  'b.loginToBook': 'Войдите, чтобы забронировать',
  'b.zoomHint': 'Масштабируйте и двигайте схему',
  'b.hall': 'Зал',

  'pay.title': 'Оплата депозита',
  'pay.amount': 'К оплате',
  'pay.left': 'Осталось',
  'pay.test': 'Тестовый режим: реальные деньги не списываются',
  'pay.pay': 'Оплатить',
  'pay.decline': 'Сымитировать отказ',
  'pay.expired': 'Время оплаты истекло. Столик освобождён.',

  'done.confirmed': 'Бронь подтверждена',
  'done.pending': 'Ожидает оплаты',
  'done.failed': 'Оплата не прошла',
  'done.showQr': 'Покажите QR-код администратору ресторана',
  'done.number': 'Номер брони',
  'done.cancel': 'Отменить бронь',
  'done.cancelConfirm': 'Отменить бронирование? Депозит будет возвращён согласно правилам ресторана.',
  'done.payNow': 'Оплатить',
  'done.retry': 'Забронировать снова',

  'my.title': 'Мои бронирования',
  'my.upcoming': 'Предстоящие',
  'my.past': 'История',
  'my.empty': 'Здесь появятся ваши брони',
  'my.favorites': 'Избранное',

  'auth.login': 'Вход',
  'auth.register': 'Регистрация',
  'auth.identifier': 'Email или телефон',
  'auth.password': 'Пароль',
  'auth.name': 'Имя и фамилия',
  'auth.passwordHint': 'Минимум 8 символов, буквы и цифры',
  'auth.noAccount': 'Нет аккаунта?',
  'auth.haveAccount': 'Уже есть аккаунт?',
  'auth.submitLogin': 'Войти',
  'auth.submitRegister': 'Создать аккаунт',

  'profile.title': 'Профиль',
  'profile.save': 'Сохранить',
  'profile.saved': 'Сохранено',
  'profile.password': 'Смена пароля',
  'profile.current': 'Текущий пароль',
  'profile.new': 'Новый пароль',
  'profile.language': 'Язык',

  'status.pending_payment': 'Ожидает оплаты',
  'status.confirmed': 'Подтверждена',
  'status.cancelled': 'Отменена',
  'status.checked_in': 'Гость пришёл',
  'status.completed': 'Завершена',
  'status.no_show': 'Не пришёл',
  'status.payment_failed': 'Оплата не прошла',

  'common.loading': 'Загрузка…',
  'common.error': 'Что-то пошло не так',
  'common.tenge': '₸',
  'common.persons': 'чел.',
}

type Key = keyof typeof ru

const kk: Record<Key, string> = {
  'nav.restaurants': 'Мейрамханалар',
  'nav.myBookings': 'Броньдарым',
  'nav.login': 'Кіру',
  'nav.register': 'Тіркелу',
  'nav.logout': 'Шығу',
  'nav.profile': 'Профиль',
  'nav.partner': 'Мейрамхана панелі',
  'nav.admin': 'Әкімші панелі',

  'home.title': 'Ең жақсы үстел —\nбірнеше түртумен',
  'home.subtitle': 'Астанадағы мейрамхананы таңдап, залды қарап, нақты үстелді онлайн брондаңыз.',
  'home.search': 'Мейрамхана, ас мәзірі немесе мекенжай',
  'home.all': 'Барлығы',
  'home.popular': 'Танымал',
  'home.recommended': 'Ұсынамыз',
  'home.allPlaces': 'Барлық мекемелер',
  'home.nothing': 'Ештеңе табылмады. Басқа сұраныс жасап көріңіз.',
  'home.how1': 'Күн мен уақытты таңдаңыз',
  'home.how2': 'Зал сызбасынан үстелді белгілеңіз',
  'home.how3': 'Депозит енгізіп, QR алыңыз',

  'r.book': 'Үстел брондау',
  'r.about': 'Мейрамхана туралы',
  'r.menu': 'Мәзір',
  'r.photos': 'Суреттер',
  'r.reviews': 'Пікірлер',
  'r.hours': 'Жұмыс кестесі',
  'r.contacts': 'Байланыс',
  'r.closed': 'Демалыс',
  'r.avgCheck': 'Орташа чек',
  'r.deposit': 'Депозит',
  'r.noReviews': 'Әзірге пікір жоқ',
  'r.reviewsCount': 'пікір',
  'r.writeReview': 'Пікір қалдыру',
  'r.send': 'Жіберу',
  'r.noMenu': 'Мәзір жақында пайда болады',

  'b.title': 'Брондау',
  'b.date': 'Күні',
  'b.time': 'Уақыты',
  'b.guests': 'Қонақтар',
  'b.chooseTable': 'Үстелді таңдаңыз',
  'b.noSlots': 'Бұл күнге бос уақыт жоқ',
  'b.legend.free': 'Бос',
  'b.legend.selected': 'Таңдалды',
  'b.legend.booked': 'Брондалған',
  'b.legend.unavailable': 'Қолжетімсіз',
  'b.table': 'Үстел',
  'b.seats': 'орын',
  'b.select': 'Таңдау',
  'b.selected': 'Таңдалды',
  'b.contacts': 'Байланыс деректері',
  'b.name': 'Аты',
  'b.phone': 'Телефон',
  'b.email': 'Растау үшін email',
  'b.comment': 'Тілектер (міндетті емес)',
  'b.review': 'Броньды тексеріңіз',
  'b.continue': 'Жалғастыру',
  'b.back': 'Артқа',
  'b.toPay': 'Төлемге өту',
  'b.confirm': 'Броньды растау',
  'b.depositNote': 'Депозит есепке қосылады. Төленбеген бронь 10 минуттан кейін жойылады.',
  'b.loginToBook': 'Брондау үшін кіріңіз',
  'b.zoomHint': 'Сызбаны үлкейтіп, жылжытуға болады',
  'b.hall': 'Зал',

  'pay.title': 'Депозит төлеу',
  'pay.amount': 'Төленетін сома',
  'pay.left': 'Қалды',
  'pay.test': 'Тест режимі: нақты ақша алынбайды',
  'pay.pay': 'Төлеу',
  'pay.decline': 'Бас тартуды имитациялау',
  'pay.expired': 'Төлеу уақыты өтті. Үстел босатылды.',

  'done.confirmed': 'Бронь расталды',
  'done.pending': 'Төлемді күтуде',
  'done.failed': 'Төлем өтпеді',
  'done.showQr': 'QR-кодты мейрамхана әкімшісіне көрсетіңіз',
  'done.number': 'Бронь нөмірі',
  'done.cancel': 'Броньды болдырмау',
  'done.cancelConfirm': 'Броньды болдырмайсыз ба? Депозит мейрамхана ережелеріне сәйкес қайтарылады.',
  'done.payNow': 'Төлеу',
  'done.retry': 'Қайта брондау',

  'my.title': 'Менің броньдарым',
  'my.upcoming': 'Алдағы',
  'my.past': 'Тарих',
  'my.empty': 'Мұнда сіздің броньдарыңыз пайда болады',
  'my.favorites': 'Таңдаулылар',

  'auth.login': 'Кіру',
  'auth.register': 'Тіркелу',
  'auth.identifier': 'Email немесе телефон',
  'auth.password': 'Құпиясөз',
  'auth.name': 'Аты-жөні',
  'auth.passwordHint': 'Кемінде 8 таңба, әріптер мен сандар',
  'auth.noAccount': 'Аккаунтыңыз жоқ па?',
  'auth.haveAccount': 'Аккаунтыңыз бар ма?',
  'auth.submitLogin': 'Кіру',
  'auth.submitRegister': 'Аккаунт ашу',

  'profile.title': 'Профиль',
  'profile.save': 'Сақтау',
  'profile.saved': 'Сақталды',
  'profile.password': 'Құпиясөзді өзгерту',
  'profile.current': 'Ағымдағы құпиясөз',
  'profile.new': 'Жаңа құпиясөз',
  'profile.language': 'Тіл',

  'status.pending_payment': 'Төлемді күтуде',
  'status.confirmed': 'Расталды',
  'status.cancelled': 'Болдырылмады',
  'status.checked_in': 'Қонақ келді',
  'status.completed': 'Аяқталды',
  'status.no_show': 'Келмеді',
  'status.payment_failed': 'Төлем өтпеді',

  'common.loading': 'Жүктелуде…',
  'common.error': 'Бірдеңе дұрыс болмады',
  'common.tenge': '₸',
  'common.persons': 'адам',
}

export const LANGS = { ru: 'Рус', kk: 'Қаз' } as const
export type Lang = keyof typeof LANGS
const DICTS: Record<Lang, Record<Key, string>> = { ru, kk }

const LANG_KEY = 'reserve.lang'

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY)
    if (saved && saved in DICTS) return saved as Lang
  } catch {
    /* ignore */
  }
  return navigator.language?.startsWith('kk') ? 'kk' : 'ru'
}

interface Ctx {
  lang: Lang
  setLang: (l: Lang) => void
  t: (k: Key) => string
}

const I18nCtx = createContext<Ctx>(null!)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang)
  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    document.documentElement.lang = l
    try {
      localStorage.setItem(LANG_KEY, l)
    } catch {
      /* ignore */
    }
  }, [])
  const t = useCallback((k: Key) => DICTS[lang][k] ?? ru[k] ?? k, [lang])
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t])
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useI18n = () => useContext(I18nCtx)
