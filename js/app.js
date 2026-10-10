import {
  KIND_LABELS, buildICS, editDistance, fmtDate, fmtDateTime, markChanges, normName,
  personalItems, prettyTitle, todayISO, addDays, weekdayName, weekTitle, monthlyTotals, calculateSalary, INTRO_ROLE_LABELS,
} from './core.js';
import { loadPersonalEvents, savePersonalEvent, deletePersonalEvent, personalStorageKey } from './personal.js';

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь',
  'Октябрь', 'Ноябрь', 'Декабрь'];

const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICON = {
  arrow: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 17v5M8 3h8l-1 6 3 4H6l3-4z"/></svg>',
  cal: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/></svg>',
  file: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
};

/* ---------- хранилище на устройстве ---------- */
const store = {
  get(k, d) {
    try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* приватный режим */ }
  },
};
const PIN = 'rs.pinned';
const RECENT = 'rs.recent';
const VIEW = 'rs.view';
const salaryKey = (name) => `rs.salary.v1.${normName(name)}`;
const savedView = store.get(VIEW, 'list');

/* ---------- данные ---------- */
const state = {
  index: null, weeks: new Map(), offline: false, pastLimit: 4, showPast: false,
  listRequest: 0, pastRequest: 0, salaryTotals: null,
  view: ['list', 'calendar', 'totals', 'calculator'].includes(savedView) ? savedView : 'list',
  month: null, // 'YYYY-MM' в календаре
  selDay: null, // выбранный день в календаре
  totalsMonth: null, // 'YYYY-MM' в итогах
  rendered: [], // недели, показанные сейчас (для кнопки «В календарь» у события)
};

async function fetchJSON(path) {
  const res = await fetch(`${path}?v=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (res.headers.get('X-From-Cache')) setOffline(true);
  return res.json();
}

function setOffline(on) {
  state.offline = on;
  const s = $('#status');
  s.hidden = !on;
  s.textContent = 'Нет сети · сохранённая версия';
}

async function loadIndex() {
  if (!state.index) {
    try {
      state.index = await fetchJSON('data/index.json');
    } catch {
      state.index = { weeks: [], calendars: {}, failed: true };
    }
    renderFooter();
  }
  return state.index;
}

async function loadWeek(id) {
  if (!state.weeks.has(id)) state.weeks.set(id, fetchJSON(`data/weeks/${id}.json`).catch(() => null));
  return state.weeks.get(id);
}

function allPeople() {
  const map = new Map();
  for (const w of state.index?.weeks || []) for (const n of w.people || []) map.set(normName(n), n);
  return [...map.values()].sort((a, b) => a.localeCompare(b, 'ru'));
}

const capitalize = (s) => {
  const t = String(s).trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/* ---------- маршруты ---------- */
function route() {
  closePersonalEditor();
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  if (h.startsWith('p/') && h.length > 2) return showPerson(h.slice(2));
  if (!h) {
    const pinned = store.get(PIN, null);
    if (pinned) {
      location.replace(`#/p/${encodeURIComponent(pinned)}`);
      return;
    }
  }
  return showSearch();
}
const goPerson = (name) => { location.hash = `#/p/${encodeURIComponent(name)}`; };

/* ---------- поиск ---------- */
async function showSearch() {
  document.title = 'Расписание';
  $('#searchLink').hidden = true;
  const pinned = store.get(PIN, null);
  const recent = store.get(RECENT, []).filter((n) => n !== pinned);
  view.innerHTML = `
    <section class="search">
      <h1>Чьё расписание<br>показать?</h1>
      <form class="field" id="form" autocomplete="off">
        <input class="input" id="q" type="search" placeholder="Фамилия" aria-label="Фамилия"
          autocapitalize="words" autocorrect="off" spellcheck="false" enterkeyhint="search">
        <button class="go" aria-label="Показать">${ICON.arrow}</button>
      </form>
      <ul class="suggest" id="sug" hidden></ul>
      ${pinned ? `<div class="group-label">Закреплено</div>
        <div class="chips-row"><a class="pill on" href="#/p/${encodeURIComponent(pinned)}">${ICON.pin}${esc(pinned)}</a></div>` : ''}
      ${recent.length ? `<div class="group-label">Недавние</div>
        <div class="chips-row">${recent.map((n) => `<a class="pill" href="#/p/${encodeURIComponent(n)}">${esc(n)}</a>`).join('')}</div>` : ''}
    </section>`;
  const q = $('#q');
  const sug = $('#sug');
  await loadIndex();

  const matches = (text) => {
    const t = normName(text);
    if (!t) return [];
    const all = allPeople();
    const starts = all.filter((n) => normName(n).startsWith(t));
    const has = all.filter((n) => !starts.includes(n) && normName(n).includes(t));
    return [...starts, ...has].slice(0, 6);
  };
  const highlight = (name, text) => {
    const i = normName(name).indexOf(normName(text));
    if (i < 0) return esc(name);
    return `${esc(name.slice(0, i))}<b>${esc(name.slice(i, i + text.trim().length))}</b>${esc(name.slice(i + text.trim().length))}`;
  };
  q.addEventListener('input', () => {
    const list = matches(q.value);
    sug.hidden = !list.length;
    sug.innerHTML = list.map((n) => `<li><button type="button" data-name="${esc(n)}">${highlight(n, q.value)}</button></li>`).join('');
  });
  sug.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-name]');
    if (b) goPerson(b.dataset.name);
  });
  $('#form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = q.value.trim();
    if (!v) return q.focus();
    const exact = allPeople().find((n) => normName(n) === normName(v));
    const list = matches(v);
    goPerson(exact || (list.length === 1 ? list[0] : capitalize(v)));
  });
  if (!pinned && !recent.length) q.focus();
}

/* ---------- лента человека ---------- */
let current = null;

async function showPerson(rawName) {
  await loadIndex();
  const key = normName(rawName);
  const known = allPeople().find((n) => normName(n) === key);
  const name = known || capitalize(rawName);
  if (current?.key !== key) { state.showPast = false; state.pastLimit = 4; }
  current = { name, key, known: !!known };
  document.title = `${name} — расписание`;
  $('#searchLink').hidden = false;
  if (known) store.set(RECENT, [name, ...store.get(RECENT, []).filter((n) => n !== name)].slice(0, 6));

  const pinned = store.get(PIN, null) === name;
  view.innerHTML = `
    <section class="person-head">
      <h1>${esc(name)}</h1>
      <div class="person-actions">
        <button class="pill ${pinned ? 'on' : ''}" id="pinBtn" aria-pressed="${pinned}">${ICON.pin}<span>${pinned ? 'Закреплено' : 'Закрепить'}</span></button>
        ${state.index.calendars?.[key] ? `<button class="pill" id="calBtn">${ICON.cal}В календарь телефона</button>` : ''}
      </div>
    </section>
    <div class="tabs" role="tablist">
      ${[['list', 'Список'], ['calendar', 'Календарь'], ['totals', 'Итоги'], ['calculator', 'Калькулятор']].map(([v, label]) => `
        <button role="tab" data-tab="${v}" class="${state.view === v ? 'on' : ''}" aria-selected="${state.view === v}">${label}</button>`).join('')}
    </div>
    <div id="feed"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>`;

  $('#pinBtn').addEventListener('click', (e) => {
    const on = store.get(PIN, null) !== name;
    store.set(PIN, on ? name : null);
    const b = e.currentTarget;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on);
    b.querySelector('span').textContent = on ? 'Закреплено' : 'Закрепить';
  });
  $('#calBtn')?.addEventListener('click', openCalendarSheet);
  view.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    state.view = b.dataset.tab;
    store.set(VIEW, state.view);
    view.querySelectorAll('[data-tab]').forEach((x) => {
      x.classList.toggle('on', x === b);
      x.setAttribute('aria-selected', x === b);
    });
    renderFeed();
  }));
  bindFeed($('#feed'));
  renderFeed();
}

function renderFeed() {
  const feed = $('#feed');
  if (!feed || !current) return;
  if (state.view !== 'calculator') state.salaryTotals = null;
  if (state.index.failed && ['totals', 'calculator'].includes(state.view)) {
    feed.innerHTML = '<div class="empty"><div class="big">Не удалось загрузить расписание</div>Проверьте интернет и обновите страницу.</div>';
    return;
  }
  if (state.view === 'totals' || state.view === 'calculator') return renderTotals(feed, state.view === 'calculator');
  return state.view === 'calendar' ? renderCalendar(feed) : renderList(feed);
}

// Записи человека за неделю + отменённые (из прошлой версии недели) с отметками изменений.
function weekEntries(w, key, keep) {
  const items = personalItems(w.events, key).filter(keep);
  const removed = w.previous
    ? markChanges(items, personalItems(w.previous.events, key).filter(keep)).map((r) => ({ ...r, removed: true }))
    : [];
  return [...items, ...removed]
    .map((it) => Object.assign(it, { week: w }))
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
}

const isChange = (it) => it.removed || !!it.change;
const noteHTML = (it) => `<div class="note">${esc(prettyTitle(it.ev.title).heading)}</div>`;
const entryHTML = (it) => (it.type === 'personal' ? personalCard(it.ev) : it.type === 'note' ? noteHTML(it) : card(it, it.week));
const personalEntry = (ev) => ({ type: 'personal', ev, sortKey: `${ev.date} ${ev.start || '00:00'}` });
const byTime = (a, b) => (a.sortKey || `${a.ev.date} 00:00`).localeCompare(b.sortKey || `${b.ev.date} 00:00`);

function changesBanner(entries, hint = 'Они отмечены ниже.') {
  const n = entries.filter(isChange).length;
  return n
    ? `<div class="banner"><span class="dot"></span><div>Расписание обновлено — у вас ${n} ${plural(n, 'изменение', 'изменения', 'изменений')}. ${hint}</div></div>`
    : '';
}

/* ---------- вид списком ---------- */
async function listSection(upcoming, person) {
  const { key } = person;
  const today = todayISO();
  const idx = state.index;
  const metas = upcoming
    ? idx.weeks.filter((w) => w.end >= today)
    : idx.weeks.filter((w) => w.start < today);
  const keepDate = (d) => (upcoming ? d >= today : d < today);
  let personal = [], personalError = '';
  try { personal = loadPersonalEvents(key).filter((ev) => keepDate(ev.date)); } catch (e) { personalError = e.message; }

  let groups = metas.map((meta) => ({ meta, personal: [] }));
  for (const ev of personal) {
    let group = groups.find(({ meta }) => ev.date >= meta.start && ev.date <= meta.end);
    if (!group) {
      const offset = (new Date(`${ev.date}T12:00:00`).getDay() + 6) % 7;
      const start = addDays(ev.date, -offset), end = addDays(start, 6);
      group = { meta: { start, end, title: weekTitle(start, end) }, personal: [] };
      groups.push(group);
    }
    group.personal.push(personalEntry(ev));
  }
  groups.sort((a, b) => upcoming ? a.meta.start.localeCompare(b.meta.start) : b.meta.start.localeCompare(a.meta.start));
  const hasMore = !upcoming && groups.length > state.pastLimit;
  if (!upcoming) groups = groups.slice(0, state.pastLimit);

  const loaded = await Promise.all(groups.map(({ meta }) => meta.id ? loadWeek(meta.id) : null));
  if (current !== person) return null;
  const weeks = loaded.filter(Boolean);
  const keep = (it) => keepDate(it.ev.date);

  let html = '';
  const all = [];
  for (let i = 0; i < groups.length; i++) {
    const { meta, personal } = groups[i];
    const w = loaded[i];
    const entries = [...(w ? weekEntries(w, key, keep) : []), ...personal].sort(byTime);
    all.push(...entries);
    if (!entries.some((i) => i.type !== 'note')) continue;
    html += weekHeader(w || meta);
    const days = [...new Set(entries.map((i) => i.ev.date))].sort();
    for (const d of days) {
      const list = entries.filter((i) => i.ev.date === d);
      if (!list.some((i) => i.type !== 'note')) continue;
      html += dayHeader(d, today) + list.map(entryHTML).join('');
    }
  }

  return { weeks, all, personalError, html: html
    ? html + (hasMore ? `<button class="pill more-btn" data-more>${ICON.plus}Показать ещё прошлые дни</button>` : '')
    : emptyState(upcoming) };
}

async function renderList(feed) {
  const person = current, request = ++state.listRequest;
  const section = await listSection(true, person);
  if (!section || current !== person || state.view !== 'list' || $('#feed') !== feed || request !== state.listRequest) return;
  state.pastRequest++;
  state.rendered = section.weeks;
  feed.innerHTML = (state.index.failed ? '<div class="banner">Театральное расписание не удалось загрузить. Личные дела доступны в этом браузере.</div>' : '')
    + (section.personalError ? `<div class="banner">${esc(section.personalError)}</div>` : '')
    + `<details class="past-days" data-past ${state.showPast ? 'open' : ''}>
        <summary>${state.showPast ? 'Скрыть прошлые дни' : 'Показать прошлые дни'}</summary>
        <div id="pastList">${state.showPast ? '<div class="skeleton"></div>' : ''}</div>
      </details>`
    + changesBanner(section.all) + section.html;
  if (state.showPast) await renderPast(feed);
}

async function renderPast(feed) {
  const person = current, box = $('#pastList', feed), request = ++state.pastRequest;
  if (!box || !state.showPast) return;
  const section = await listSection(false, person);
  if (!section || current !== person || state.view !== 'list' || !state.showPast
    || $('#feed') !== feed || $('#pastList', feed) !== box || request !== state.pastRequest) return;
  state.rendered = [...new Map([...state.rendered, ...section.weeks].map((w) => [w.id, w])).values()];
  box.innerHTML = (section.personalError ? `<div class="banner">${esc(section.personalError)}</div>` : '') + section.html;
}

/* ---------- вид календарём ---------- */
const monthOf = (iso) => iso.slice(0, 7);
function shiftMonth(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function renderCalendar(feed) {
  const person = current;
  const { key } = person;
  const today = todayISO();
  const idx = state.index;
  const ym = state.month || monthOf(today);
  state.month = ym;

  const [y, m] = ym.split('-').map(Number);
  const first = `${ym}-01`;
  const offset = (new Date(y, m - 1, 1).getDay() + 6) % 7; // неделя с понедельника
  const daysInMonth = new Date(y, m, 0).getDate();
  const cells = Math.ceil((offset + daysInMonth) / 7) * 7;
  const gridStart = addDays(first, -offset);
  const gridEnd = addDays(gridStart, cells - 1);

  const metas = idx.weeks.filter((w) => w.start <= gridEnd && w.end >= gridStart);
  const weeks = (await Promise.all(metas.map((mt) => loadWeek(mt.id)))).filter(Boolean);
  if (current !== person || state.view !== 'calendar' || state.month !== ym || $('#feed') !== feed) return;
  state.rendered = weeks;

  const inGrid = (it) => it.ev.date >= gridStart && it.ev.date <= gridEnd;
  let personal = [], personalError = '';
  try { personal = loadPersonalEvents(key); } catch (e) { personalError = e.message; }
  const entries = [...weeks.flatMap((w) => weekEntries(w, key, inGrid)),
    ...personal.filter((e) => e.date >= gridStart && e.date <= gridEnd).map(personalEntry)].sort(byTime);
  const byDay = new Map();
  for (const it of entries) {
    if (!byDay.has(it.ev.date)) byDay.set(it.ev.date, []);
    byDay.get(it.ev.date).push(it);
  }
  const covered = (d) => metas.some((w) => d >= w.start && d <= w.end);

  let sel = state.selDay;
  if (!sel || monthOf(sel) !== ym) {
    const busy = [...byDay.keys()].filter((d) => monthOf(d) === ym && byDay.get(d).some((i) => i.type !== 'note')).sort();
    sel = monthOf(today) === ym ? today : busy[0] || first;
  }
  state.selDay = sel;

  let grid = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((d) => `<div class="cal-wd">${d}</div>`).join('');
  for (let i = 0; i < cells; i++) {
    const d = addDays(gridStart, i);
    const list = (byDay.get(d) || []).filter((it) => it.type !== 'note');
    const live = list.filter((it) => !it.removed);
    const hasPersonal = live.some((it) => it.type === 'personal');
    const cls = ['cal-day', monthOf(d) !== ym && 'out', d === today && 'today', d === sel && 'sel',
      !covered(d) && !hasPersonal && 'nodata', live.length && 'busy'].filter(Boolean).join(' ');
    const label = `${fmtDate(d)}, ${live.length ? `${live.length} ${plural(live.length, 'занятость', 'занятости', 'занятостей')}` : 'свободно'}${hasPersonal ? ', есть личные дела' : ''}`;
    grid += `<button class="${cls}" data-day="${d}" aria-label="${label}" aria-pressed="${d === sel}">
      <span class="num">${Number(d.slice(8))}</span>
      <span class="dots">${live.filter((it) => it.type !== 'personal').slice(0, hasPersonal ? 2 : 3).map((it) => `<i class="k-${it.ev.kind}"></i>`).join('')}${hasPersonal ? '<i class="k-personal"></i>' : ''}</span>
      ${list.some(isChange) ? '<span class="chg" aria-hidden="true"></span>' : ''}
    </button>`;
  }

  const upcomingEntries = entries.filter((it) => it.ev.date >= today);
  feed.innerHTML = `
    ${idx.failed ? '<div class="banner">Театральное расписание не удалось загрузить. Личные дела доступны в этом браузере.</div>' : ''}
    ${personalError ? `<div class="banner">${esc(personalError)}</div>` : ''}
    ${changesBanner(upcomingEntries, 'Дни с изменениями отмечены оранжевой точкой.')}
    <div class="cal">
      <div class="cal-head">
        <button class="cal-nav" data-nav="-1" aria-label="Предыдущий месяц" ${ym <= '1900-01' ? 'disabled' : ''}>${ICON.prev}</button>
        <h2>${MONTHS[m - 1]} ${y}</h2>
        <button class="cal-nav" data-nav="1" aria-label="Следующий месяц" ${ym >= '9999-12' ? 'disabled' : ''}>${ICON.next}</button>
      </div>
      <div class="cal-grid">${grid}</div>
      ${monthOf(today) !== ym ? '<button class="cal-today" data-today>Сегодня</button>' : ''}
    </div>
    <div id="dayList"></div>`;
  state.calDays = { byDay, covered, person };
  renderDayList(sel);
}

function renderDayList(d) {
  const box = $('#dayList');
  if (!box) return;
  const { byDay, covered, person } = state.calDays;
  if (current !== person) return;
  const list = byDay.get(d) || [];
  const busy = list.some((i) => i.type !== 'note');
  let body;
  if (busy) body = (!covered(d) ? '<div class="day-empty">Театральное расписание на этот день ещё не загружено</div>' : '')
    + list.map(entryHTML).join('');
  else if (!covered(d)) body = '<div class="day-empty">Расписание на этот день ещё не загружено</div>';
  else body = list.map(noteHTML).join('') + '<div class="day-empty">Занятостей нет</div>';
  box.innerHTML = dayHeader(d, todayISO())
    + `<button class="pill personal-add" data-personal-add="${d}">${ICON.plus}Добавить личное дело</button>
      <p class="personal-hint">Личные дела видны только в этом браузере, для выбранной фамилии.</p>` + body;
}

function selectDay(d) {
  if (monthOf(d) !== state.month) {
    state.month = monthOf(d);
    state.selDay = d;
    renderFeed();
    return;
  }
  state.selDay = d;
  document.querySelectorAll('.cal-day').forEach((b) => {
    const on = b.dataset.day === d;
    b.classList.toggle('sel', on);
    b.setAttribute('aria-pressed', on);
  });
  renderDayList(d);
}

function navMonth(n) {
  const btn = document.querySelector(`[data-nav="${n}"]`);
  if (!btn || btn.disabled) return;
  state.month = shiftMonth(state.month, n);
  state.selDay = null;
  renderFeed();
}

/* ---------- личные дела в этом браузере ---------- */
let personalEditor = null;
const personalFields = ['date', 'title', 'start', 'end', 'place', 'note'];

function personalCard(event) {
  return `<article class="personal-card">
    <div class="time">${event.start ? `<span>${esc(event.start)}</span>${event.end ? `<span class="sub">–${esc(event.end)}</span>` : ''}` : '<span class="personal-all-day">Весь день</span>'}</div>
    <div><div class="kind k-personal">Личное дело</div><div class="personal-title">${esc(event.title)}</div>
      ${event.place ? `<div class="personal-place">${esc(event.place)}</div>` : ''}
      ${event.note ? `<p class="personal-note">${esc(event.note).replace(/\r?\n/g, '<br>')}</p>` : ''}
      <button class="btn-sm" data-personal-edit="${esc(event.id)}" aria-label="Изменить личное дело «${esc(event.title)}»">Изменить</button>
    </div>
  </article>`;
}

function personalError(message) {
  const box = $('#personalError');
  box.textContent = message;
  box.hidden = !message;
}

function closePersonalEditor() {
  const dlg = $('#personalDlg');
  if (dlg?.open) dlg.close();
  personalEditor = null;
}

function openPersonalEditor(date, id = null) {
  if (!current) return;
  const form = $('#personalForm');
  if (!form) { location.reload(); return; }
  form.reset();
  personalError('');
  personalEditor = { key: current.key, name: current.name, id };
  $('#personalDialogTitle').textContent = id ? 'Изменить личное дело' : 'Новое личное дело';
  $('#personalFor').textContent = `${current.name} · только в этом браузере`;
  $('#personalDelete').hidden = !id;
  let event = { date: date || state.selDay || todayISO() };
  try {
    const events = loadPersonalEvents(current.key);
    if (id) {
      event = events.find((e) => e.id === id);
      if (!event) throw new Error('Личное дело уже удалено. Закройте форму и обновите календарь.');
    }
  } catch (e) { personalError(e.message); }
  for (const field of personalFields) form.elements.namedItem(field).value = event?.[field] || '';
  $('#personalDlg').showModal();
  form.elements.namedItem('title').focus();
}

$('#personalForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const editor = personalEditor;
  if (!editor || current?.key !== editor.key) return personalError('Фамилия изменилась. Закройте форму и откройте личное дело заново.');
  const form = e.currentTarget;
  if (!form.reportValidity()) return;
  const fields = Object.fromEntries(personalFields.map((field) => [field, form.elements.namedItem(field).value]));
  try {
    const event = savePersonalEvent(editor.key, { ...fields, id: editor.id });
    closePersonalEditor();
    state.month = monthOf(event.date);
    state.selDay = event.date;
    renderFeed();
  } catch (err) { personalError(err.message); }
});
$('#personalCancel')?.addEventListener('click', closePersonalEditor);
$('#personalDlg')?.addEventListener('close', () => { personalEditor = null; });
$('#personalForm')?.addEventListener('input', () => personalError(''));
$('#personalDelete')?.addEventListener('click', () => {
  const editor = personalEditor;
  if (!editor?.id || current?.key !== editor.key) return;
  if (!confirm('Удалить это личное дело?')) return;
  try {
    const event = deletePersonalEvent(editor.key, editor.id);
    closePersonalEditor();
    state.month = monthOf(event.date);
    state.selDay = event.date;
    renderFeed();
  } catch (err) { personalError(err.message); }
});
window.addEventListener('storage', (e) => {
  if (current && ['calendar', 'list'].includes(state.view)
    && (e.key === null || e.key === personalStorageKey(current.key))) renderFeed();
});

/* ---------- месячные итоги ---------- */
const fmtCount = (n) => String(n).replace('.', ',');
const monthLabel = (ym) => `${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`;

function totalsMonths() {
  const months = new Set([monthOf(todayISO())]);
  for (const w of state.index.weeks) {
    for (let m = monthOf(w.start); m <= monthOf(w.end); m = shiftMonth(m, 1)) months.add(m);
  }
  return [...months].sort();
}

function totalsStats(t, possible = false) {
  return `<dl class="totals-stats">
    <div class="totals-show"><dt>Спектаклей</dt><dd><strong>${fmtCount(t.shows)}</strong>
      ${!possible ? `<span>(${fmtCount(t.aboveNorm)} выше нормы)</span>` : ''}
      ${t.halfShows ? `<small>(${t.halfShows} ${plural(t.halfShows, 'показ', 'показа', 'показов')} по 0,5)</small>` : ''}</dd></div>
    ${Object.entries(INTRO_ROLE_LABELS).map(([r, label]) => `<div><dt>${label}</dt><dd>${t.introDays[r]} <span>${plural(t.introDays[r], 'день', 'дня', 'дней')}</span></dd></div>`).join('')}
    <div><dt>Выездных спектаклей</dt><dd>${t.awayShows}</dd></div>
    <div><dt>Бэбиков</dt><dd>${t.babyShows}</dd></div>
  </dl>`;
}

function totalsDetails(t, label) {
  if (!t.showItems.length && !t.awayItems.length && !t.introItems.length) return '';
  const showsList = (items) => `<ul>${items.map((s) => `<li><div class="totals-date">${fmtDate(s.ev.date)} · ${esc(s.time || 'время не указано')}</div>
    <div>${esc(prettyTitle(s.ev.title).heading)}${s.weight === 0.5 && !s.away ? ' <span class="chip">0,5</span>' : ''}${s.baby ? ' <span class="chip">бэбик</span>' : ''}</div>
    ${s.ev.place ? `<div class="muted">${esc(s.ev.place)}</div>` : ''}</li>`).join('')}</ul>`;
  return `<details class="totals-details"><summary>${label}</summary>
    ${t.showItems.length ? `<h3>Спектакли (${t.performances} ${plural(t.performances, 'показ', 'показа', 'показов')})</h3>
      ${showsList(t.showItems)}` : ''}
    ${t.awayItems.length ? `<h3>Выездные спектакли (${t.awayShows} ${plural(t.awayShows, 'показ', 'показа', 'показов')})</h3>${showsList(t.awayItems)}` : ''}
    ${t.introItems.length ? `<h3>Дни вводов</h3><ul>${t.introItems.map((i) => `<li>
      <div class="totals-date">${fmtDate(i.date)} · ${INTRO_ROLE_LABELS[i.role]}</div>
      <div>${i.titles.map(esc).join(', ')}</div></li>`).join('')}</ul>` : ''}
  </details>`;
}

const money = (n) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(n);
const salaryLabels = {
  show: 'Спектакли сверх нормы', baby: 'Бэбики сверх нормы',
  awayFirst: 'Выезды: первый показ за день', awayExtra: 'Выезды: последующие показы',
  newcomer: 'Вводящийся', mentor: 'Вводящий', actor: 'Актёр на вводе',
};

function salaryDetails(calc, totals) {
  const list = (items, away) => `<ul>${items.map((s) => `<li>
    <div class="totals-date">${fmtDate(s.ev.date)} · ${esc(s.time || 'время не указано')}</div>
    <div>${esc(prettyTitle(s.ev.title).heading)}${s.baby ? ' <span class="chip">бэбик</span>' : ''}${s.weight === 0.5 && !away ? ' <span class="chip">0,5</span>' : ''}</div>
    <div class="muted">${s.percent ? `+${fmtCount(s.percent)}% от оклада${!away && s.units < s.weight ? ' · часть показа сверх нормы' : ''}` : 'В пределах нормы — без доплаты'}</div>
  </li>`).join('')}</ul>`;
  return `<details class="totals-details"><summary>Посмотреть расчёт по датам</summary>
    ${calc.showCharges.length ? `<h3>Спектакли в театре</h3>${list(calc.showCharges, false)}` : ''}
    ${calc.awayCharges.length ? `<h3>Выезды, гастроли и фестивали</h3>${list(calc.awayCharges, true)}` : ''}
    ${totals.confirmed.introItems.length ? `<h3>Дни вводов</h3><ul>${totals.confirmed.introItems.map((i) => `<li>
      <div class="totals-date">${fmtDate(i.date)} · ${INTRO_ROLE_LABELS[i.role]}</div>
      <div>${i.titles.map(esc).join(', ')}</div>
      <div class="muted">+${calc.lines.find((l) => l.key === i.role).rate}% от оклада</div>
    </li>`).join('')}</ul>` : ''}
  </details>`;
}

function updateSalaryResult() {
  const box = $('#salaryResult'), input = $('[data-salary]'), context = state.salaryTotals;
  if (!box || !input || !context || context.person !== current || state.view !== 'calculator' || context.ym !== state.totalsMonth) return;
  input.setAttribute('aria-invalid', 'false');
  if (!input.value.trim()) {
    box.innerHTML = '<p class="calc-placeholder">Введите оклад, чтобы увидеть приблизительную зарплату.</p>';
    return;
  }
  try {
    const calc = calculateSalary(context.totals, input.value);
    box.innerHTML = `<section class="calc-result" aria-label="Приблизительная зарплата">
        <p>Примерно на руки</p><strong>${money(calc.net)}</strong><span>После удержания ${calc.taxRate}% налога</span>
      </section>
      <dl class="calc-ledger">
        <div><dt>Оклад</dt><dd>${money(calc.base)}</dd></div>
        ${calc.lines.map((line) => `<div><dt>${salaryLabels[line.key]}<small>${fmtCount(line.count)} × ${line.rate}% = ${fmtCount(line.percent)}%</small></dt><dd>${money(line.amount)}</dd></div>`).join('')}
        <div class="calc-total"><dt>Всего доплат <small>${fmtCount(calc.bonusPercent)}% от оклада</small></dt><dd>${money(calc.bonus)}</dd></div>
        <div class="calc-total"><dt>Начислено до налога</dt><dd>${money(calc.gross)}</dd></div>
        <div><dt>Налог ${calc.taxRate}%</dt><dd>−${money(calc.tax)}</dd></div>
      </dl>${salaryDetails(calc, context.totals)}`;
  } catch (e) {
    input.setAttribute('aria-invalid', 'true');
    box.innerHTML = `<p class="calc-error" role="alert">${esc(e.message)}</p>`;
  }
}

async function renderTotals(feed, calculator = false) {
  const person = current;
  const targetView = calculator ? 'calculator' : 'totals';
  state.salaryTotals = null;
  if (!person.known) { feed.innerHTML = emptyState(false); return; }
  const months = totalsMonths();
  const ym = state.totalsMonth || monthOf(todayISO());
  state.totalsMonth = ym;
  const header = `<section class="totals-head"><h2>${calculator ? 'Калькулятор' : 'Итоги'}</h2>
    <p class="totals-notice"><strong>Все расчёты приблизительны.</strong> Как всегда, мы не знаем, кто и что точно сыграет.</p>
    <label class="totals-month">Месяц<select data-totals-month aria-label="${calculator ? 'Месяц расчёта' : 'Месяц итогов'}">
      ${months.map((m) => `<option value="${m}" ${m === ym ? 'selected' : ''}>${monthLabel(m)}</option>`).join('')}</select></label>
  </section>`;
  feed.innerHTML = header + '<div class="skeleton"></div>';
  const [y, m] = ym.split('-').map(Number);
  const first = `${ym}-01`, last = `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
  const metas = state.index.weeks.filter((w) => w.start <= last && w.end >= first);
  const loaded = await Promise.all(metas.map((w) => loadWeek(w.id)));
  if (current !== person || state.view !== targetView || state.totalsMonth !== ym || $('#feed') !== feed) return;
  const weeks = loaded.filter(Boolean);
  const totals = monthlyTotals(weeks, person.key, ym);
  const { confirmed, possible, coverage } = totals;
  const hasPossible = possible.showItems.length || possible.awayItems.length || possible.introItems.length;
  const failed = weeks.length < metas.length;
  const notices = `
    ${failed ? '<div class="banner">Часть расписаний не загрузилась. Показаны итоги только по доступным неделям. Обновите страницу при подключении к интернету.</div>' : ''}
    <p class="totals-coverage">${coverage.days ? `Расписание загружено на ${coverage.days} из ${coverage.totalDays} дней месяца.` : 'Расписание на этот месяц ещё не загружено.'}
      ${coverage.days ? ' Учтены все опубликованные даты, включая предстоящие.' : ''}</p>`;
  if (calculator) {
    state.salaryTotals = { person, ym, totals };
    feed.innerHTML = header + notices + `
      <div class="calc-form"><label for="salaryBase">Оклад, ₽</label>
        <input id="salaryBase" data-salary type="text" inputmode="decimal" autocomplete="off" placeholder="Например, 50000" value="${esc(store.get(salaryKey(person.key), ''))}" aria-describedby="salaryHint">
        <p id="salaryHint">До удержания налога. Оклад сохраняется только в этом браузере.</p>
      </div>
      ${!coverage.days ? '<p class="totals-rules">Расписание на этот месяц не загружено — пока можно посчитать только оклад после налога.</p>' : ''}
      ${hasPossible ? '<p class="totals-rules">Участия под вопросом и альтернативный состав в сумму не включены. Их можно посмотреть в «Итогах».</p>' : ''}
      <div id="salaryResult" aria-live="polite"></div>
      <p class="totals-rules">Первые ${totals.norm} спектаклей входят в норму. Далее обычный показ даёт +5%, бэбик — только +3%. Порядок — по датам и времени.
        «Теремок» у Баранова и Носова учитывается по 0,5; часть сверх нормы оплачивается пропорционально.
        Выезды, гастроли и фестивали считаются отдельно: первый показ каждого дня +6%, каждый следующий +5%.
        День ввода: вводящийся +6%, вводящий +3%, актёр на вводе +4%. Налог 13% удерживается с оклада и всех доплат.</p>`;
    updateSalaryResult();
    return;
  }
  feed.innerHTML = header + notices + `
    ${coverage.days ? `<section class="totals-panel" aria-label="Итоги по расписанию">${totalsStats(confirmed)}</section>
      <p class="totals-rules">Норма спектаклей в театре — ${totals.norm}. «Собачка» и «Первый снег малыша» — бэбики, каждый считается как 1 спектакль.
        «Теремок» для Баранова и Носова считается по 0,5 за показ, для остальных — как 1.
        Каждый личный показ считается отдельно. Выезды учитываются отдельной графой и не влияют на норму. Вводы считаются по дням, а не по числу репетиций; роли берутся из состава.</p>
      ${totalsDetails(confirmed, 'Посмотреть учтённые даты')}
      ${hasPossible ? `<section class="totals-panel totals-possible"><h3>Под вопросом — отдельно</h3>
        <p class="totals-rules">Участия с «?» и альтернативным составом не включены в основные итоги.</p>
        ${totalsStats(possible, true)}${totalsDetails(possible, 'Посмотреть возможные участия')}</section>` : ''}` : ''}`;
}

function emptyState(upcoming) {
  const { name, key, known } = current;
  if (!known) {
    const similar = allPeople().map((n) => [n, editDistance(normName(n), key)])
      .filter(([, d]) => d <= 2).sort((a, b) => a[1] - b[1]).slice(0, 4).map(([n]) => n);
    return `<div class="empty"><div class="big">Фамилия «${esc(name)}» не найдена</div>
      ${similar.length ? 'Возможно, вы имели в виду:' : 'Проверьте написание — в расписании такой фамилии пока нет.'}
      ${similar.length ? `<div class="chips-row">${similar.map((n) => `<a class="pill" href="#/p/${encodeURIComponent(n)}">${esc(n)}</a>`).join('')}</div>` : ''}</div>`;
  }
  return upcoming
    ? '<div class="empty"><div class="big">Ближайших занятостей нет</div>Как только выйдет новое расписание, оно появится здесь.</div>'
    : '<div class="empty"><div class="big">Прошедших занятостей нет</div>Здесь будут прошлые дни.</div>';
}

const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

function weekHeader(w) {
  return `<div class="week-head">
    <div><h2>${esc(w.title)}</h2>${w.version > 1 ? `<div class="upd">обновлено ${esc(fmtDateTime(w.updatedAt))}</div>` : ''}</div>
    <div class="links">${w.pdf ? `<a href="${esc(w.pdf)}" target="_blank" rel="noopener">PDF</a>` : ''}</div>
  </div>`;
}

function dayHeader(d, today) {
  const wd = weekdayName(d);
  const tag = d === today ? 'сегодня' : d === addDays(today, 1) ? 'завтра' : '';
  return `<div class="day"><h3>${wd.charAt(0).toUpperCase() + wd.slice(1)}</h3><span class="date">${fmtDate(d)}</span>${tag ? `<span class="today">${tag}</span>` : ''}</div>`;
}

function timeHTML(it) {
  if (!it.timeLabel.length) return '<span class="na">—</span>';
  return it.timeLabel.map((t, i) => (t.startsWith('–') || (i > 0 && it.range) ? `<span class="sub">${esc(t)}</span>` : `<span>${esc(t)}</span>`)).join('');
}

function chipsHTML(it) {
  const c = [];
  if (it.removed) c.push('<span class="chip warn">отменено</span>');
  else if (it.change?.type === 'new') c.push('<span class="chip ok">новое</span>');
  else if (it.change?.type === 'changed') c.push('<span class="chip warn">изменено</span>');
  if (it.type === 'all') c.push('<span class="chip">для всех</span>');
  for (const r of it.roles) c.push(`<span class="chip acc">${esc(r)}</span>`);
  if (it.uncertainAll) c.push(`<span class="chip warn">под вопросом${it.alts.length ? ` · или ${esc(it.alts.join(', '))}` : ''}</span>`);
  if (it.unsureTimes.length) {
    c.push(`<span class="chip warn">${esc(it.unsureTimes.join(', '))} — под вопросом${it.alts.length ? ` · или ${esc(it.alts.join(', '))}` : ''}</span>`);
  }
  if (it.ev.timeUncertain && !it.uncertainAll) c.push('<span class="chip warn">время уточняется</span>');
  for (const n of it.notes) c.push(`<span class="chip">${esc(n)}</span>`);
  return c.length ? `<div class="chips">${c.join('')}</div>` : '';
}

// Состав с подсветкой фамилии (без регулярных выражений с lookbehind — для старых iOS).
function castHTML(lines, key) {
  return lines.map((line) => line.split(/([А-ЯЁа-яё-]+)/).map((part) => (
    normName(part) === key ? `<mark>${esc(part)}</mark>` : esc(part))).join('')).join('<br>');
}

function card(it, w) {
  const ev = it.ev;
  const { heading, sub } = prettyTitle(ev.title);
  const kind = KIND_LABELS[ev.kind];
  const meta = [ev.place, ev.tech].filter(Boolean).join(' · ');
  const cls = ['card', it.removed ? 'removed' : '', it.change?.type === 'changed' ? 'changed' : '', it.change?.type === 'new' ? 'added' : ''].join(' ');
  const before = it.change?.before;
  const id = `${w.id}:${ev.id}${it.removed ? ':old' : ''}`;
  return `<article class="${cls}" tabindex="0" data-id="${esc(id)}" aria-expanded="false">
    <div class="time">${timeHTML(it)}</div>
    <div>
      ${kind ? `<div class="kind k-${ev.kind}">${kind}</div>` : ''}
      <div class="title">${esc(heading)}</div>
      ${sub ? `<div class="subtitle">${esc(sub)}</div>` : ''}
      ${meta ? `<div class="meta">${esc(meta)}</div>` : ''}
      ${chipsHTML(it)}
    </div>
    <div class="more">
      ${before ? `<h4>Было</h4><p class="was">${esc([before.timeLabel.join(' '), before.ev.place, before.roles.join(', ')].filter(Boolean).join(' · '))}</p>` : ''}
      <h4>В расписании</h4><p>${esc(ev.title)}${ev.timeText ? ` · ${esc(ev.timeText)}` : ''}</p>
      ${ev.lines.length ? `<h4>Состав</h4><p>${castHTML(ev.lines, current.key)}</p>` : ''}
      <div class="row">
        ${!it.removed && it.timeLabel.length ? `<button class="btn-sm" data-ics>${ICON.cal}В календарь</button>` : ''}
        ${w.pdf ? `<a class="btn-sm" href="${esc(w.pdf)}" target="_blank" rel="noopener">${ICON.file}Оригинал PDF</a>` : ''}
      </div>
    </div>
  </article>`;
}

// Один обработчик на всю ленту (содержимое перерисовывается, обработчики не копятся).
function bindFeed(feed) {
  const findItem = (id) => {
    const [wid, eid] = id.split(':');
    const w = state.rendered.find((x) => x.id === wid);
    const ev = w?.events.find((e) => e.id === eid);
    return ev ? personalItems([ev], current.key)[0] : null;
  };
  feed.addEventListener('toggle', (e) => {
    if (!e.target.matches('[data-past]') || e.target.open === state.showPast) return;
    state.showPast = e.target.open;
    e.target.querySelector('summary').textContent = state.showPast ? 'Скрыть прошлые дни' : 'Показать прошлые дни';
    if (state.showPast) renderPast(feed);
    else state.pastRequest++;
  }, true);
  feed.addEventListener('input', (e) => {
    if (!e.target.matches('[data-salary]') || !current) return;
    store.set(salaryKey(current.key), e.target.value);
    updateSalaryResult();
  });
  feed.addEventListener('change', (e) => {
    if (!e.target.matches('[data-totals-month]')) return;
    state.totalsMonth = e.target.value;
    renderFeed();
  });
  feed.addEventListener('click', (e) => {
    const t = e.target;
    const addPersonal = t.closest('[data-personal-add]');
    if (addPersonal) return openPersonalEditor(addPersonal.dataset.personalAdd);
    const editPersonal = t.closest('[data-personal-edit]');
    if (editPersonal) return openPersonalEditor(null, editPersonal.dataset.personalEdit);
    const day = t.closest('[data-day]');
    if (day) return selectDay(day.dataset.day);
    const nav = t.closest('[data-nav]');
    if (nav) return navMonth(Number(nav.dataset.nav));
    if (t.closest('[data-today]')) {
      state.month = null;
      state.selDay = null;
      return renderFeed();
    }
    if (t.closest('[data-more]')) {
      state.pastLimit += 4;
      return renderPast(feed);
    }
    const c = t.closest('.card');
    if (!c) return;
    if (t.closest('[data-ics]')) {
      const it = findItem(c.dataset.id);
      if (it) downloadICS(buildICS([it]), `${it.ev.date}.ics`);
      return;
    }
    if (t.closest('a')) return;
    const open = c.classList.toggle('open');
    c.setAttribute('aria-expanded', open);
  });
  feed.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('card')) {
      e.preventDefault();
      e.target.click();
    }
  });
  // Листание месяцев свайпом по сетке календаря.
  let touch = null;
  feed.addEventListener('touchstart', (e) => {
    touch = e.target.closest('.cal-grid') ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  }, { passive: true });
  feed.addEventListener('touchend', (e) => {
    if (!touch) return;
    const dx = e.changedTouches[0].clientX - touch.x;
    const dy = e.changedTouches[0].clientY - touch.y;
    touch = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) navMonth(dx < 0 ? 1 : -1);
  }, { passive: true });
}

/* ---------- календарь ---------- */
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function downloadICS(text, filename) {
  if (isIOS()) {
    // Safari на iPhone открывает такой файл сразу в «Календаре».
    location.href = `data:text/calendar;charset=utf-8,${encodeURIComponent(text)}`;
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function openCalendarSheet() {
  const path = state.index.calendars?.[current.key];
  if (!path) return;
  const abs = new URL(path, location.href).href;
  const webcal = abs.replace(/^https?:/, 'webcal:');
  $('#calWebcal').href = webcal;
  // Google принимает подписку только по webcal-ссылке (https в cid «добавляется», но календарь не появляется).
  // ?v=2 — чтобы ссылка отличалась от прежней: повторную подписку на тот же адрес Google иногда молча игнорирует.
  $('#calGoogle').href = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(`${webcal}?v=2`)}`;
  $('#calFile').href = abs;
  $('#calFile').setAttribute('download', `${current.name}.ics`);
  $('#calCopy').dataset.url = abs;
  $('#calCopy').textContent = 'Скопировать ссылку на календарь';
  const dlg = $('#calSheet');
  if (dlg.showModal) dlg.showModal();
  else dlg.setAttribute('open', '');
}
$('#calSheet').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) e.currentTarget.close();
});
$('#calCopy').addEventListener('click', async (e) => {
  const b = e.currentTarget;
  try {
    await navigator.clipboard.writeText(b.dataset.url);
    b.textContent = 'Ссылка скопирована';
  } catch {
    prompt('Скопируйте ссылку:', b.dataset.url);
  }
});

/* ---------- подвал ---------- */
function renderFooter() {
  const idx = state.index;
  $('#foot').textContent = idx?.updatedAt ? `Данные обновлены ${fmtDateTime(idx.updatedAt)}` : '';
}

/* ---------- запуск ---------- */
window.addEventListener('hashchange', route);
window.addEventListener('online', () => setOffline(false));
document.addEventListener('visibilitychange', async () => {
  // Вернулись в приложение спустя время — подтягиваем свежие данные.
  if (document.visibilityState !== 'visible' || !state.index || Date.now() - (state.loadedAt || 0) < 5 * 60e3) return;
  state.index = null;
  state.weeks.clear();
  state.loadedAt = Date.now();
  await loadIndex();
  if (current && location.hash.startsWith('#/p/')) renderFeed();
});
state.loadedAt = Date.now();
route();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  // Вышла новая версия приложения — один раз перезагружаемся, чтобы сразу её показать.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded) {
      reloaded = true;
      location.reload();
    }
  });
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
