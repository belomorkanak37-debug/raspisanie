import {
  KIND_LABELS, buildICS, editDistance, fmtDate, fmtDateTime, markChanges, normName,
  personalItems, prettyTitle, todayISO, addDays, weekdayName,
} from './core.js';

const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICON = {
  arrow: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 17v5M8 3h8l-1 6 3 4H6l3-4z"/></svg>',
  cal: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/></svg>',
  file: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
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

/* ---------- данные ---------- */
const state = { index: null, weeks: new Map(), offline: false, tab: 'upcoming', archiveLimit: 4 };

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
      <button role="tab" data-tab="upcoming" class="${state.tab === 'upcoming' ? 'on' : ''}">Ближайшие</button>
      <button role="tab" data-tab="archive" class="${state.tab === 'archive' ? 'on' : ''}">Архив</button>
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
    state.tab = b.dataset.tab;
    view.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
    renderFeed();
  }));
  renderFeed();
}

async function renderFeed() {
  const feed = $('#feed');
  if (!feed || !current) return;
  const { key } = current;
  const today = todayISO();
  const idx = state.index;

  if (idx.failed) {
    feed.innerHTML = `<div class="empty"><div class="big">Не удалось загрузить расписание</div>Проверьте интернет и обновите страницу.</div>`;
    return;
  }

  const upcoming = state.tab === 'upcoming';
  let metas = upcoming
    ? idx.weeks.filter((w) => w.end >= today)
    : idx.weeks.filter((w) => w.start < today).sort((a, b) => b.start.localeCompare(a.start));
  const hasMore = !upcoming && metas.length > state.archiveLimit;
  if (!upcoming) metas = metas.slice(0, state.archiveLimit);

  const weeks = (await Promise.all(metas.map((m) => loadWeek(m.id)))).filter(Boolean);
  const inRange = (it) => (upcoming ? it.ev.date >= today : it.ev.date < today);

  let html = '';
  let total = 0;
  let changes = 0;
  for (const w of weeks) {
    const items = personalItems(w.events, key).filter(inRange);
    let removed = [];
    if (w.previous) {
      const prev = personalItems(w.previous.events, key).filter(inRange);
      removed = markChanges(items, prev);
      changes += removed.length + items.filter((i) => i.change).length;
    }
    const mine = items.filter((i) => i.type !== 'note');
    total += mine.length;
    if (!mine.length && !removed.length) continue;

    const byDay = new Map();
    for (const it of [...items, ...removed.map((r) => ({ ...r, removed: true }))]) {
      if (!byDay.has(it.ev.date)) byDay.set(it.ev.date, []);
      byDay.get(it.ev.date).push(it);
    }
    const days = [...byDay.keys()].sort();
    html += weekHeader(w);
    for (const d of days) {
      const list = byDay.get(d).sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1));
      if (!list.some((i) => i.type !== 'note')) continue;
      html += dayHeader(d, today);
      html += list.map((it) => (it.type === 'note' ? `<div class="note">${esc(prettyTitle(it.ev.title).heading)}</div>` : card(it, w))).join('');
    }
  }

  const banner = changes && upcoming
    ? `<div class="banner"><span class="dot"></span><div>Расписание обновлено — у вас ${changes} ${plural(changes, 'изменение', 'изменения', 'изменений')}. Они отмечены ниже.</div></div>`
    : '';

  if (!total && !html) {
    feed.innerHTML = emptyState(upcoming);
  } else {
    feed.innerHTML = banner + html
      + (hasMore ? `<button class="pill more-btn" id="moreBtn">${ICON.plus}Показать ещё</button>` : '');
  }
  $('#moreBtn')?.addEventListener('click', () => { state.archiveLimit += 4; renderFeed(); });
  bindCards(feed, weeks);
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
    : '<div class="empty"><div class="big">В архиве пока пусто</div>Здесь будут прошедшие занятости.</div>';
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

function bindCards(feed, weeks) {
  const findItem = (id) => {
    const [wid, eid] = id.split(':');
    const w = weeks.find((x) => x.id === wid);
    const ev = w?.events.find((e) => e.id === eid);
    return ev ? personalItems([ev], current.key)[0] : null;
  };
  feed.addEventListener('click', (e) => {
    const icsBtn = e.target.closest('[data-ics]');
    const c = e.target.closest('.card');
    if (!c) return;
    if (icsBtn) {
      const it = findItem(c.dataset.id);
      if (it) downloadICS(buildICS([it]), `${it.ev.date}.ics`);
      return;
    }
    if (e.target.closest('a')) return;
    const open = c.classList.toggle('open');
    c.setAttribute('aria-expanded', open);
  });
  feed.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('card')) {
      e.preventDefault();
      e.target.click();
    }
  });
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
  $('#calGoogle').href = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`;
  $('#calFile').href = abs;
  $('#calFile').setAttribute('download', `${current.name}.ics`);
  const dlg = $('#calSheet');
  if (dlg.showModal) dlg.showModal();
  else dlg.setAttribute('open', '');
}
$('#calSheet').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) e.currentTarget.close();
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
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
