// Общие функции для приложения и админки: даты, разбор состава,
// персональная выборка, поиск изменений, календарь (.ics).

export const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля',
  'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

export const KIND_LABELS = {
  show: 'Спектакль', rehearsal: 'Репетиция', intro: 'Ввод', handover: 'Сдача',
  meeting: 'Собрание', trip: 'Выезд', other: '',
};

/* ---------- даты ---------- */

export const pad = (n) => String(n).padStart(2, '0');
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function fromISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export const todayISO = () => toISO(new Date());
export function addDays(iso, n) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}
export const weekdayName = (iso) => WEEKDAYS[fromISO(iso).getDay()];
export function fmtDate(iso) {
  const d = fromISO(iso);
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
}
export function weekTitle(start, end) {
  const a = fromISO(start), b = fromISO(end);
  if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ${MONTHS_GEN[b.getMonth()]}`;
  return `${fmtDate(start)} — ${fmtDate(end)}`;
}
export function fmtDateTime(isoStamp) {
  const d = new Date(isoStamp);
  if (isNaN(d)) return '';
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const MONTH_RE = /(январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)[а-яё]*\s+(\d{4})/iu;
const MONTH_STEMS = ['январ', 'феврал', 'март', 'апрел', 'ма', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];

// «ПЛАН РАБОТЫ На ОКТЯБРЬ 2026 года» → { month: 9, year: 2026 }
export function detectYearMonth(text) {
  const m = MONTH_RE.exec(text || '');
  if (!m) return null;
  const stem = m[1].toLowerCase();
  const month = MONTH_STEMS.findIndex((s) => stem.startsWith(s) && (s !== 'ма' || /^ма[йя]/.test(stem)));
  return { month, year: Number(m[2]) };
}

// День и месяц из «28.09» → ISO-дата с учётом года из шапки документа.
export function resolveDate(day, month, hint) {
  if (hint) {
    let y = hint.year;
    if (hint.month === 11 && month === 1) y += 1;
    if (hint.month === 0 && month === 12) y -= 1;
    return `${y}-${pad(month)}-${pad(day)}`;
  }
  const now = new Date();
  let best = null;
  for (const y of [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]) {
    const d = new Date(y, month - 1, day);
    if (!best || Math.abs(d - now) < Math.abs(best - now)) best = d;
  }
  return toISO(best);
}

/* ---------- имена ---------- */

export const normName = (s) => String(s || '').trim().toLowerCase().replace(/ё/g, 'е');

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k',
  л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};
export function translit(s) {
  return normName(s).split('').map((c) => (c in TRANSLIT ? TRANSLIT[c] : /[a-z0-9]/.test(c) ? c : '-'))
    .join('').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'x';
}

// Расстояние Левенштейна — для подсказок при опечатке в фамилии.
export function editDistance(a, b) {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/* ---------- время ---------- */

const TIME_RE = /(\d{1,2})[:.](\d{2})/g;
const normTime = (h, m) => `${pad(Number(h))}:${m}`;

// «12:00 - 14:30» → диапазон; «11:00 13:00 15:00» → несколько начал.
export function parseTimeText(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const times = [];
  for (const m of t.matchAll(TIME_RE)) {
    if (Number(m[1]) < 24) times.push(normTime(m[1], m[2]));
  }
  const isRange = times.length === 2 && /\d\s*[–—−-]\s*\d{1,2}[:.]\d{2}/.test(t);
  return {
    text: t,
    times: isRange ? [times[0]] : times,
    range: isRange ? { from: times[0], to: times[1] } : null,
    uncertain: t.includes('?'),
  };
}

export function addMinutes(hhmm, min) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = Math.min(h * 60 + m + min, 23 * 60 + 59);
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/* ---------- названия ---------- */

export function detectKind(title) {
  const t = String(title || '').trim().toLowerCase();
  if (/^ввод/.test(t)) return 'intro';
  if (/^сдача/.test(t)) return 'handover';
  if (/^(репетиц|прогон)/.test(t)) return 'rehearsal';
  if (/^спектак/.test(t)) return 'show';
  if (/^собрани/.test(t)) return 'meeting';
  if (/^(отъезд|выезд|гастрол|фестивал)/.test(t)) return 'trip';
  if (/спектакль|спектакля/.test(t) && !/репетиц/.test(t)) return 'show';
  if (/репетиц/.test(t)) return 'rehearsal';
  return 'other';
}

// Длинные слова КАПСОМ → обычный регистр; аббревиатуры (БДФ, РПТ) не трогаем.
export function tidyCase(s) {
  const out = String(s || '').split(' ')
    .map((w) => (w.length >= 5 && /[А-ЯЁ]/.test(w) && w === w.toUpperCase() ? w.toLowerCase() : w))
    .join(' ').trim();
  return out.charAt(0).toUpperCase() + out.slice(1);
}

const KIND_WORDS = /(репетиция\s+спектакля|ввод\s+в\s+спектакль|сдача\s+(?:а\.\s*с\.\s*)?спектакля|спектакль|репетиция|ввод|сдача)/i;

// «Репетиция спектакля «Оксюморон» / Басня «Ловля»» → { heading: 'Оксюморон', sub: 'Басня «Ловля»' }
export function prettyTitle(title) {
  const q = /«([^»]+)»?/.exec(title || '');
  if (!q) return { heading: tidyCase(title || 'Без названия'), sub: '' };
  let rest = title.replace(q[0], ' ').replace(KIND_WORDS, ' ');
  rest = rest.replace(/\s+/g, ' ').replace(/^[\s/–—-]+|[\s/–—-]+$/g, '');
  return { heading: q[1].trim(), sub: /[а-яёa-z]/i.test(rest) ? tidyCase(rest) : '' };
}

/* ---------- разбор состава ---------- */

const NAME_RE = /^[А-ЯЁ][а-яё]+(?:-[А-ЯЁ]?[а-яё]+)*$/;
const NOT_NAMES = new Set(['вводящийся', 'вводящаяся', 'вводящиеся', 'вводящий', 'вводящая', 'вводящие',
  'монтировщики', 'монтировщик', 'звук', 'свет', 'реквизит', 'костюмы', 'костюмер', 'грим', 'гример',
  'гримёр', 'все', 'весь', 'вся', 'кроме', 'состав', 'участники', 'спектакль', 'репетиция', 'ввод',
  'сдача', 'начало', 'сбор', 'отъезд', 'выезд', 'прогон', 'москва', 'возможно', 'или']);

const TOKEN_RE = /(\d{1,2})[:.](\d{2})|([A-Za-zА-ЯЁа-яё]+(?:-[A-Za-zА-ЯЁа-яё]+)*)(\?)?|([–—−-])|([,;.])|(\/)|(\()|(\))|(\?)/g;

function tokenize(line) {
  const out = [];
  for (const m of line.matchAll(TOKEN_RE)) {
    if (m[1]) out.push({ t: 'time', v: normTime(m[1], m[2]), raw: m[0] });
    else if (m[3]) out.push({ t: 'word', v: m[3], q: !!m[4], raw: m[0] });
    else if (m[5]) out.push({ t: 'dash', raw: m[0] });
    else if (m[6]) out.push({ t: 'sep', v: m[6], raw: m[0] });
    else if (m[7]) out.push({ t: 'slash', raw: m[0] });
    else if (m[8]) out.push({ t: 'open', raw: m[0] });
    else if (m[9]) out.push({ t: 'close', raw: m[0] });
    else if (m[10]) out.push({ t: 'q', raw: m[0] });
    out[out.length - 1].pos = m.index;
  }
  return out;
}

// Пометка в скобках после фамилии: «(с 15:00)», «(11:00 и 13:00)», «(?)».
function applyAnnotation(targets, inner, source = '') {
  let times = inner.filter((t) => t.t === 'time').map((t) => t.v);
  // В PDF встречается сокращённое время: «Андреев (11 и 13)», «Заяшников (15)».
  // Принимаем только целую пометку со списком часов, а не числа внутри произвольного текста.
  if (!times.length && /^(?:(?:с|со|после|до|в)\s+)?\d{1,2}(?:\s*(?:и|,|\/)\s*\d{1,2})*\s*\??$/i.test(source.trim())) {
    const hours = source.match(/\d{1,2}/g).map(Number);
    if (hours.every((h) => h < 24)) times = hours.map((h) => `${pad(h)}:00`);
  }
  const words = inner.filter((t) => t.t === 'word').map((t) => t.v.toLowerCase());
  const hasFrom = words.some((w) => ['с', 'со', 'после'].includes(w));
  const hasTo = words.includes('до');
  const q = inner.some((t) => t.t === 'q' || t.q);
  const otherWords = words.filter((w) => !['с', 'со', 'и', 'до', 'после', 'в'].includes(w));
  const text = inner.map((t) => t.raw).join(' ').replace(/\s+([,?])/g, '$1').trim();
  for (const p of targets) {
    if (q) p.uncertain = true;
    if (times.length) {
      if (hasFrom) p.from = times[0];
      else if (hasTo) p.note = `до ${times[0]}`;
      else p.times = times;
    }
    if (otherWords.length) p.note = p.note ? `${p.note}; ${text}` : text;
  }
}

/**
 * Разбирает строки состава в список участников.
 * Понимает: «11:00 и 13:00 – Глазецкая ; 15:00 – Миронова», «Вводящийся – Радыгин; вводящий – Кожев»,
 * «Трунина (с 13:00)», «Самойлов (11:00 и 13:00)», «Лоскутов (?) / Радыгин (?)», «Мартюшева?/Сигитова?».
 */
export function parseParticipants(lines) {
  const people = [];
  let ctx = { times: null, role: null };
  let carry = false;
  for (const rawLine of lines || []) {
    // \u041d\u0430\u0437\u0432\u0430\u043d\u0438\u044f \u0432 \u00ab\u0451\u043b\u043e\u0447\u043a\u0430\u0445\u00bb \u2014 \u043d\u0435 \u0444\u0430\u043c\u0438\u043b\u0438\u0438.
    const line = String(rawLine).replace(/\u00a0/g, ' ').replace(/\u00ab[^\u00bb]*\u00bb?/g, ' ');
    if (!carry) ctx = { times: null, role: null };
    const toks = tokenize(line);
    let pendingTimes = [];
    let group = [];
    let sinceSep = [];
    let prev = null;
    for (let i = 0; i < toks.length; i++) {
      const tk = toks[i];
      if (tk.t === 'time') {
        pendingTimes.push(tk.v);
        sinceSep = [];
        prev = 'time';
      } else if (tk.t === 'dash') {
        if (pendingTimes.length) {
          ctx.times = pendingTimes;
          pendingTimes = [];
        } else if (sinceSep.length) {
          // Слова перед тире — это роль («вводящий – …»), а не фамилии.
          for (const s of sinceSep) {
            if (s.person) people.splice(people.indexOf(s.person), 1);
          }
          ctx.role = sinceSep.map((s) => s.word).join(' ').toLowerCase();
        }
        sinceSep = [];
        group = [];
        prev = 'dash';
      } else if (tk.t === 'open') {
        let j = i + 1;
        const inner = [];
        while (j < toks.length && toks[j].t !== 'close') inner.push(toks[j++]);
        const targets = group.length ? group : people.slice(-1);
        applyAnnotation(targets, inner, line.slice(tk.pos + 1, toks[j]?.pos ?? line.length));
        i = j;
        sinceSep = [];
        prev = 'paren';
      } else if (tk.t === 'sep') {
        if (tk.v === ';') {
          ctx = { times: null, role: null };
          pendingTimes = [];
        }
        sinceSep = [];
        group = [];
        prev = 'sep';
      } else if (tk.t === 'slash') {
        prev = 'slash';
      } else if (tk.t === 'q') {
        (group.length ? group : people.slice(-1)).forEach((p) => { p.uncertain = true; });
      } else if (tk.t === 'word') {
        const w = tk.v;
        if (NAME_RE.test(w) && !NOT_NAMES.has(w.toLowerCase())) {
          if (pendingTimes.length) {
            ctx.times = pendingTimes;
            pendingTimes = [];
          }
          const p = {
            name: w, times: ctx.times ? ctx.times.slice() : null, from: null,
            role: ctx.role, uncertain: tk.q, alts: [], note: null,
          };
          if (prev === 'slash' && group.length) {
            group.forEach((g) => { g.alts.push(w); p.alts.push(g.name); });
            group.push(p);
          } else {
            group = [p];
          }
          people.push(p);
          sinceSep.push({ word: w, person: p });
          prev = 'name';
        } else if (!(w === 'и' && prev === 'time')) {
          sinceSep.push({ word: w });
          prev = 'word';
        }
      }
    }
    carry = /,\s*$/.test(line.trim());
  }
  people.forEach((p) => { if (p.alts.length) p.uncertain = true; });
  return people;
}

/* ---------- событие ---------- */

export function autoScope(times, people, title) {
  if (!times.length && !people.length) return 'note';
  if (!people.length && /коллектив|всех|общ|собрани/i.test(title)) return 'all';
  return 'people';
}

// scope: 'people' — только участникам, 'all' — всем, 'note' — пометка дня (например, «ВЫХОДНОЙ»).
export function buildEvent({ id, date, timeText = '', title = '', lines = [], place = '', tech = '', scope }) {
  const tt = parseTimeText(timeText);
  const cleanLines = lines.map((l) => String(l).replace(/\s+/g, ' ').trim()).filter(Boolean);
  const people = parseParticipants(cleanLines);
  const cleanTitle = String(title).replace(/\s+/g, ' ').trim();
  const ev = {
    id, date, timeText: tt.text, times: tt.times, range: tt.range, timeUncertain: tt.uncertain,
    title: cleanTitle, kind: detectKind(cleanTitle),
    place: String(place).replace(/\s+/g, ' ').replace(/\s*\/\s*/g, ' / ').trim(),
    tech: String(tech).replace(/\s+/g, ' ').trim(),
    lines: cleanLines, people,
    scope: scope || autoScope(tt.times, people, cleanTitle),
  };
  ev.accounting = eventAccounting(ev);
  return ev;
}

export const eventSortKey = (ev) => `${ev.date || '9999'} ${ev.times[0] || (ev.range && ev.range.from) || (ev.scope === 'note' ? '00:00' : '99:99')}`;

export function hashStr(s) {
  let h = 5381;
  for (const ch of String(s)) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0;
  return h.toString(36);
}

export function peopleOfWeek(week) {
  const set = new Map();
  for (const ev of week.events) for (const p of ev.people) set.set(normName(p.name), p.name);
  return [...set.values()].sort((a, b) => a.localeCompare(b, 'ru'));
}

/* ---------- персональная выборка ---------- */

const uniq = (arr) => [...new Set(arr)];

// Что из события относится к человеку: его время, роль, пометки.
export function personalize(ev, key) {
  if (ev.scope === 'note') return { ev, type: 'note' };
  const entries = ev.people.filter((p) => normName(p.name) === key);
  if (ev.scope !== 'all' && !entries.length) return null;
  const specific = entries.length > 0 && entries.every((p) => p.times || p.from);
  const times = specific
    ? uniq(entries.flatMap((p) => p.times || [])).sort()
    : ev.times.slice();
  const from = entries.map((p) => p.from).find(Boolean) || null;
  const roles = uniq(entries.map((p) => p.role).filter(Boolean));
  const certain = entries.filter((p) => !p.uncertain);
  const unsure = entries.filter((p) => p.uncertain);
  const uncertainAll = entries.length > 0 && certain.length === 0;
  const unsureTimes = certain.length && unsure.length
    ? uniq(unsure.flatMap((p) => p.times || [])).sort()
    : [];
  const alts = uniq(entries.flatMap((p) => p.alts));
  const notes = uniq(entries.map((p) => p.note).filter(Boolean));
  const range = specific ? null : ev.range;

  let timeLabel;
  if (from) timeLabel = [`с ${from}`];
  else if (range) timeLabel = [range.from, `–${range.to}`];
  else if (times.length) timeLabel = times;
  else timeLabel = ev.timeText ? [ev.timeText] : [];

  return {
    ev, type: entries.length ? 'mine' : 'all',
    times, from, range, roles, uncertainAll, unsureTimes, alts, notes, timeLabel,
    sortKey: `${ev.date} ${from || times[0] || (range && range.from) || '99:99'}`,
  };
}

export function itemSignature(it) {
  const e = it.ev;
  return [e.date, it.timeLabel.join(' '), e.title, e.place, it.roles.join(','),
    it.uncertainAll, it.unsureTimes.join(','), it.notes.join(',')].join('|');
}

export function personalItems(events, key) {
  return events.map((ev) => personalize(ev, key)).filter(Boolean)
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
}

/* ---------- приблизительные итоги за месяц ---------- */

export const MONTHLY_NORM = 8;
export const INTRO_ROLE_LABELS = { mentor: 'Вводящий', newcomer: 'Вводящийся', actor: 'Актёр на вводе' };

const accountingText = (s) => normName(s).replace(/[^а-яa-z0-9]+/g, ' ').trim();

// Эти признаки сохраняются при разборе PDF и создании события в админке.
// Для уже опубликованных недель их можно получить без повторной загрузки PDF.
export function eventAccounting(ev) {
  const title = normName(ev.title);
  const kind = ev.kind || detectKind(ev.title);
  const awayTitle = /выезд|гастрол|фестивал|бдф/.test(title);
  const travelOnly = /^(отъезд|выезд\s+(?:гастрольной\s+)?группы)/.test(title);
  const show = ev.scope !== 'note' && (kind === 'show' || ((kind === 'trip' || (kind === 'other' && awayTitle))
    && !travelOnly && (/спектакл/.test(title) || (/«[^»]+»/.test(title) && ev.times?.length > 0))));
  const heading = accountingText(prettyTitle(ev.title).heading);
  const baby = show && /(^| )собачка($| )|(^| )первый снег малыша($| )/.test(heading);
  const halfFor = show && /(^| )теремок($| )/.test(heading) ? ['баранов', 'носов'] : [];
  const place = normName(ev.place);
  const away = show && (awayTitle
    || /москв|выборг|шк(?:ола|\s|\.|№)|лице[йя]|гимнази|дворец|дом культуры|губернск|(^|[^а-я])дк($|[^а-я])|ул[.\s]|проспект/.test(place));
  return { showWeight: show ? 1 : 0, baby, halfFor, away, intro: kind === 'intro' && ev.scope !== 'note' };
}

function introRole(role) {
  const r = normName(role);
  if (/вводящ(?:ийся|аяся|иеся)/.test(r)) return 'newcomer';
  if (/вводящ(?:ий|ая|ие)/.test(r)) return 'mentor';
  // Технические службы в составе ввода — не актёры на вводе.
  if (/монтиров|звук|свет|реквизит|костюм|грим/.test(r)) return null;
  return 'actor';
}

function accountingPeople(ev) {
  // Дополняем только недостающие ограничения времени в старых JSON.
  // Сохранённые фамилии, роли и пометки после ручного редактирования остаются приоритетными.
  const parsed = parseParticipants(ev.lines || []);
  const used = new Set();
  return (ev.people || []).map((p) => {
    const i = parsed.findIndex((q, n) => !used.has(n) && normName(q.name) === normName(p.name)
      && normName(q.role) === normName(p.role));
    if (i < 0) return p;
    used.add(i);
    const q = parsed[i];
    return { ...p, times: p.times || q.times, from: p.from || q.from };
  });
}

function accountingTimes(ev, p) {
  let times = p.times?.length ? p.times.slice() : (ev.times || []).slice();
  if (p.from) times = times.length ? times.filter((t) => t >= p.from) : [p.from];
  const until = /^до (\d{2}:\d{2})/.exec(p.note || '');
  if (until) times = times.filter((t) => t < until[1]);
  // Спектакль без указанного времени всё равно является одним показом.
  return uniq(times.length ? times : (!ev.times?.length && !p.from && !until ? [''] : []));
}

export function monthlyTotals(weeks, name, month) {
  const key = normName(name);
  const [year, num] = month.split('-').map(Number);
  const totalDays = new Date(year, num, 0).getDate();
  const first = `${month}-01`, last = `${month}-${pad(totalDays)}`;
  const latest = new Map();
  for (const w of weeks.filter(Boolean)) {
    const old = latest.get(w.id);
    if (!old || (w.version || 1) > (old.version || 1)
      || ((w.version || 1) === (old.version || 1) && (w.updatedAt || '') > (old.updatedAt || ''))) latest.set(w.id, w);
  }
  const covered = new Set(), shows = new Map(), intros = new Map();
  for (const w of latest.values()) {
    for (let d = w.start > first ? w.start : first; d <= w.end && d <= last; d = addDays(d, 1)) covered.add(d);
    // previous содержит отменённые и изменённые записи — в итогах берём только текущие events.
    for (const ev of w.events || []) {
      if (ev.date < first || ev.date > last || ev.scope === 'note') continue;
      const flags = eventAccounting(ev);
      if (!flags.showWeight && !flags.intro) continue;
      const entries = accountingPeople(ev).filter((p) => normName(p.name) === key);
      for (const p of entries) {
        const possible = !!p.uncertain || !!p.alts?.length;
        if (flags.showWeight) for (const time of accountingTimes(ev, p)) {
          const id = [ev.date, time, accountingText(prettyTitle(ev.title).heading), accountingText(ev.place)].join('|');
          const old = shows.get(id);
          if (!old || (old.possible && !possible)) shows.set(id, {
            ev, week: w, time, possible, weight: flags.halfFor.includes(key) ? 0.5 : flags.showWeight,
            baby: flags.baby, away: flags.away,
          });
        }
        if (flags.intro) {
          const role = introRole(p.role);
          if (!role) continue;
          const id = `${ev.date}|${role}`;
          const old = intros.get(id);
          if (!old || (old.possible && !possible)) intros.set(id, { date: ev.date, role, possible, titles: [prettyTitle(ev.title).heading] });
          else if (old.possible === possible) old.titles = uniq([...old.titles, prettyTitle(ev.title).heading]);
        }
      }
    }
  }
  const bucket = (possible) => {
    const items = [...shows.values()].filter((s) => s.possible === possible)
      .sort((a, b) => `${a.ev.date} ${a.time}`.localeCompare(`${b.ev.date} ${b.time}`));
    const showItems = items.filter((s) => !s.away);
    const awayItems = items.filter((s) => s.away);
    const introItems = [...intros.values()].filter((i) => i.possible === possible)
      .sort((a, b) => `${a.date} ${a.role}`.localeCompare(`${b.date} ${b.role}`));
    const showsCount = showItems.reduce((sum, s) => sum + s.weight, 0);
    return {
      shows: showsCount, performances: showItems.length, aboveNorm: Math.max(0, showsCount - MONTHLY_NORM),
      halfShows: showItems.filter((s) => s.weight === 0.5).length,
      babyShows: showItems.filter((s) => s.baby).length,
      awayShows: awayItems.length,
      introDays: Object.fromEntries(Object.keys(INTRO_ROLE_LABELS).map((r) => [r, introItems.filter((i) => i.role === r).length])),
      showItems, awayItems, introItems,
    };
  };
  return { month, norm: MONTHLY_NORM, confirmed: bucket(false), possible: bucket(true), coverage: { days: covered.size, totalDays } };
}

/* ---------- приблизительная зарплата ---------- */

export const SALARY_RATES = { show: 5, baby: 3, awayFirst: 6, awayExtra: 5, newcomer: 6, mentor: 3, actor: 4, tax: 13 };

export function calculateSalary(totals, salary) {
  const text = String(salary ?? '').trim().replace(/\s/g, '').replace(',', '.');
  const baseKopecks = Math.round(Number(text) * 100);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text) || !Number.isSafeInteger(baseKopecks) || baseKopecks <= 0) {
    throw new Error('Введите оклад больше нуля, в рублях и копейках.');
  }
  const t = totals.confirmed;
  const counts = { show: 0, baby: 0, awayFirst: 0, awayExtra: 0, ...t.introDays };
  let used = 0;
  // Порядок показов важен: бэбик внутри нормы не оплачивается дополнительно.
  const showCharges = t.showItems.map((s) => {
    const before = Math.max(0, used - totals.norm);
    used += s.weight;
    const units = Math.max(0, used - totals.norm) - before;
    const kind = s.baby ? 'baby' : 'show';
    counts[kind] += units;
    return { ...s, units, percent: units * SALARY_RATES[kind] };
  });
  const awayDays = new Set();
  const awayCharges = t.awayItems.map((s) => {
    const kind = awayDays.has(s.ev.date) ? 'awayExtra' : 'awayFirst';
    awayDays.add(s.ev.date);
    counts[kind]++;
    return { ...s, percent: SALARY_RATES[kind] };
  });
  const lines = ['show', 'baby', 'awayFirst', 'awayExtra', 'newcomer', 'mentor', 'actor'].map((key) => {
    const count = counts[key], rate = SALARY_RATES[key], percent = count * rate;
    return { key, count, rate, percent, amount: Math.round(baseKopecks * percent / 100) / 100 };
  });
  const bonusKopecks = lines.reduce((sum, line) => sum + Math.round(line.amount * 100), 0);
  const grossKopecks = baseKopecks + bonusKopecks;
  if (!Number.isSafeInteger(grossKopecks)) throw new Error('Оклад слишком большой для расчёта.');
  const taxKopecks = Math.round(grossKopecks * SALARY_RATES.tax / 100);
  return {
    base: baseKopecks / 100, lines, bonusPercent: lines.reduce((sum, line) => sum + line.percent, 0),
    bonus: bonusKopecks / 100, gross: grossKopecks / 100, tax: taxKopecks / 100,
    net: (grossKopecks - taxKopecks) / 100, taxRate: SALARY_RATES.tax, showCharges, awayCharges,
  };
}

// Сравнивает персональные записи с предыдущей версией недели.
// Помечает новые/изменённые и возвращает отменённые.
export function markChanges(cur, prev) {
  const real = (arr) => arr.filter((i) => i.type !== 'note');
  const curList = real(cur), prevList = real(prev);
  const prevSigs = new Set(prevList.map(itemSignature));
  const curSigs = new Set(curList.map(itemSignature));
  const used = new Set();
  for (const it of curList) {
    if (prevSigs.has(itemSignature(it))) continue;
    const before = prevList.find((p) => !used.has(p) && !curSigs.has(itemSignature(p))
      && p.ev.date === it.ev.date && p.ev.title === it.ev.title);
    if (before) used.add(before);
    it.change = before ? { type: 'changed', before } : { type: 'new' };
  }
  return prevList.filter((p) => !curSigs.has(itemSignature(p)) && !used.has(p));
}

/* ---------- календарь (.ics) ---------- */

const icsEscape = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

function foldLine(line) {
  const enc = new TextEncoder();
  const out = [];
  let cur = '';
  let bytes = 0;
  // Экранированные пары (\n, \,) не разрываем переносом — так надёжнее для разных календарей.
  for (const ch of line.match(/\\.|[\s\S]/gu) || []) {
    const b = enc.encode(ch).length;
    if (bytes + b > 73) {
      out.push(cur);
      cur = ' ';
      bytes = 1;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n');
}

const icsDate = (iso, hhmm) => `${iso.replace(/-/g, '')}T${hhmm.replace(':', '')}00`;

// Время в расписании — московское. Без явного пояса Google Календарь считает его временем UTC
// и сдвигает события на +3 часа, поэтому пояс указываем в каждом событии.
const TZID = 'Europe/Moscow';
const VTIMEZONE = ['BEGIN:VTIMEZONE', `TZID:${TZID}`, 'BEGIN:STANDARD', 'DTSTART:19700101T000000',
  'TZOFFSETFROM:+0300', 'TZOFFSETTO:+0300', 'TZNAME:MSK', 'END:STANDARD', 'END:VTIMEZONE'];

export function eventSummary(it) {
  const ev = it.ev;
  const { heading, sub } = prettyTitle(ev.title);
  const kind = KIND_LABELS[ev.kind];
  let s = kind && /«/.test(ev.title) ? `${kind} «${heading}»` : heading;
  if (sub) s += ` · ${sub}`;
  if (it.roles && it.roles.length) s += ` (${it.roles.join(', ')})`;
  if (it.uncertainAll) s += ' (?)';
  return s;
}

function spans(it) {
  if (it.from) return [[it.from, it.range ? it.range.to : addMinutes(it.from, 60)]];
  if (it.range) return [[it.range.from, it.range.to]];
  return it.times.map((t) => [t, addMinutes(t, 60)]);
}

export function buildICS(items, calName) {
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}00Z`;
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Raspisanie//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  if (calName) {
    L.push(`X-WR-CALNAME:${icsEscape(calName)}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H');
  }
  L.push(`X-WR-TIMEZONE:${TZID}`, ...VTIMEZONE);
  for (const it of items) {
    if (it.type === 'note') continue;
    const ev = it.ev;
    const desc = [ev.title, ...ev.lines, ev.tech ? `Звук/свет: ${ev.tech}` : ''].filter(Boolean).join('\n');
    for (const [a, b] of spans(it)) {
      L.push('BEGIN:VEVENT',
        `UID:${ev.date}-${a.replace(':', '')}-${hashStr(ev.title)}@raspisanie`,
        `DTSTAMP:${stamp}`,
        `DTSTART;TZID=${TZID}:${icsDate(ev.date, a)}`,
        `DTEND;TZID=${TZID}:${icsDate(ev.date, b > a ? b : addMinutes(a, 60))}`,
        `SUMMARY:${icsEscape(eventSummary(it))}`);
      if (ev.place) L.push(`LOCATION:${icsEscape(ev.place)}`);
      L.push(`DESCRIPTION:${icsEscape(desc)}`, 'END:VEVENT');
    }
  }
  L.push('END:VCALENDAR');
  return L.map(foldLine).join('\r\n') + '\r\n';
}
