import { addDays, buildEvent, eventSortKey, fmtDate, fmtDateTime, fromISO, normName, peopleOfWeek, todayISO, weekdayName, weekTitle } from './core.js';
import { GitHub, INDEX_PATH, buildCalendars, buildIndex, finalizeWeek, indexEntry, pdfPath, weekPath } from './publish.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CFG_KEY = 'rs.admin.github';
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};

/* ---------- куда публикуем ---------- */

// Режим разработки: локальный сервер разработчика сохраняет файлы прямо в папку проекта.
class LocalDev {
  constructor() { this.label = 'локальная папка проекта (режим разработки)'; }
  async readJSON(path) {
    const res = await fetch(`${path}?v=${Date.now()}`, { cache: 'no-store' });
    return res.ok ? res.json() : null;
  }
  async exists(path) {
    const res = await fetch(`${path}?v=${Date.now()}`, { method: 'HEAD', cache: 'no-store' });
    return res.ok;
  }
  async commit(files) {
    for (const f of files) {
      await fetch(`/__save/${f.path}`, { method: f.content === null ? 'DELETE' : 'PUT', body: f.content ?? undefined });
    }
  }
}

const isDev = ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).has('dev');
let backend = null;

function setupBackend() {
  const cfg = store.get(CFG_KEY);
  if (isDev) backend = new LocalDev();
  else if (cfg?.token) {
    backend = new GitHub(cfg);
    backend.label = `${cfg.owner}/${cfg.repo} · ветка ${cfg.branch}`;
  } else backend = null;
}

async function readData(path) {
  if (backend) return backend.readJSON(path);
  try {
    const res = await fetch(`${path}?v=${Date.now()}`, { cache: 'no-store' });
    return res.ok ? res.json() : null;
  } catch { return null; }
}

function renderGhPanel() {
  const form = $('#ghForm');
  const status = $('#ghStatus');
  if (backend) {
    form.hidden = true;
    status.innerHTML = `<div class="conn"><span class="dot"></span><span class="grow">Подключено: <b>${esc(backend.label)}</b></span>
      ${isDev ? '' : '<button class="btn" id="ghEdit">Изменить</button><button class="btn btn-ghost" id="ghOff">Отключить</button>'}</div>`;
    $('#ghEdit')?.addEventListener('click', () => showGhForm(true));
    $('#ghOff')?.addEventListener('click', () => {
      if (!confirm('Удалить ключ доступа из этого браузера?')) return;
      store.set(CFG_KEY, null);
      setupBackend();
      renderGhPanel();
    });
  } else {
    status.innerHTML = '<div class="conn"><span class="dot off"></span><span class="grow">Не подключено — можно проверить разбор PDF, но для публикации нужен ключ GitHub.</span></div>';
    showGhForm(false);
  }
}

function showGhForm(editing) {
  const form = $('#ghForm');
  form.hidden = false;
  $('#ghCancel').hidden = !editing;
  const cfg = store.get(CFG_KEY) || {};
  let owner = cfg.owner || '', repo = cfg.repo || '';
  if (!owner && location.hostname.endsWith('.github.io')) {
    owner = location.hostname.split('.')[0];
    repo = location.pathname.split('/').filter(Boolean)[0] || `${owner}.github.io`;
    if (repo.endsWith('.html')) repo = `${owner}.github.io`;
  }
  form.owner.value = owner;
  form.repo.value = repo;
  form.branch.value = cfg.branch || 'main';
  form.token.value = '';
}

$('#ghCancel').addEventListener('click', () => { $('#ghForm').hidden = true; });
$('#ghForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const cfg = { owner: f.owner.value.trim(), repo: f.repo.value.trim(), branch: f.branch.value.trim() || 'main', token: f.token.value.trim() };
  const err = $('#ghError');
  err.hidden = true;
  const btn = f.querySelector('[type=submit]');
  btn.disabled = true;
  btn.textContent = 'Проверяю…';
  try {
    await new GitHub(cfg).check();
    store.set(CFG_KEY, cfg);
    setupBackend();
    renderGhPanel();
    loadPublished();
    toast('Подключено');
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Подключить';
  }
});

/* ---------- опубликованные недели ---------- */
let index = null;

async function loadPublished() {
  const box = $('#published');
  try {
    index = await readData(INDEX_PATH);
  } catch (ex) {
    box.innerHTML = `<p class="error">${esc(ex.message)}</p>`;
    return;
  }
  if (!index?.weeks?.length) {
    box.innerHTML = '<p class="muted">Пока ничего не опубликовано.</p>';
    return;
  }
  box.innerHTML = [...index.weeks].sort((a, b) => b.start.localeCompare(a.start)).map((w) => `
    <div class="pub-row">
      <div class="grow"><div>${esc(w.title)}</div>
        <div class="muted">версия ${w.version || 1} · ${esc(fmtDateTime(w.updatedAt))} · ${(w.people || []).length} чел.</div></div>
      <div class="pub-actions">
        ${w.pdf ? `<a href="${esc(w.pdf)}" target="_blank" rel="noopener">PDF</a>` : ''}
        <button data-edit-week="${esc(w.id)}">Изменить</button>
        <button class="del" data-del="${esc(w.id)}">Удалить</button>
      </div>
    </div>`).join('');
}

$('#published').addEventListener('click', async (e) => {
  if (busy) return;
  const editId = e.target.closest('[data-edit-week]')?.dataset.editWeek;
  if (editId) return openManualWeek(null, editId);
  const id = e.target.closest('[data-del]')?.dataset.del;
  if (!id) return;
  const meta = index.weeks.find((w) => w.id === id);
  if (!backend) return toast('Сначала подключите GitHub');
  if (!confirm(`Удалить неделю «${meta.title}» из приложения?`)) return;
  setBusy(true);
  try {
    await commitWeeks({ remove: [id], message: `Удалена неделя ${meta.title}` });
    toast('Неделя удалена');
    loadPublished();
  } catch (ex) {
    toast(`Ошибка: ${ex.message}`, 6000);
  } finally {
    setBusy(false);
  }
});

/* ---------- черновик и отдельные события ---------- */
let draft = null; // { week, pdf, fileName, existing, overlaps, replaced, mode }
let busy = false;

function setBusy(value) {
  busy = value;
  for (const id of ['file', 'manualAddBtn', 'publishBtn', 'discardBtn']) $(`#${id}`).disabled = value;
}

function daysBetween(start, end) {
  const days = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  return days;
}

function revealPreview() {
  renderPreview();
  $('#preview').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('#manualForm').date.value = todayISO();
$('#manualForm').addEventListener('submit', (e) => {
  e.preventDefault();
  openManualWeek(e.currentTarget.date.value);
});

async function openManualWeek(date, id = null) {
  if (busy) return;
  if (draft && (id ? draft.week.id === id : date >= draft.week.start && date <= draft.week.end)) {
    revealPreview();
    if (date) openEditor(null, date);
    return;
  }
  if (draft && !confirm('Есть неопубликованные изменения. Отменить их и открыть другую неделю?')) return;
  setBusy(true);
  try {
    const idx = (await readData(INDEX_PATH)) || { weeks: [] };
    const meta = idx.weeks.find((w) => id ? w.id === id : w.start <= date && w.end >= date);
    if (id && !meta) throw new Error('Эта неделя больше не опубликована. Обновите страницу.');
    const existing = meta ? await readData(weekPath(meta.id)) : null;
    if (meta && !existing) throw new Error('Не удалось загрузить неделю. Попробуйте ещё раз.');
    let week;
    if (existing) {
      week = JSON.parse(JSON.stringify(existing));
      week.days = daysBetween(week.start, week.end);
      week.warnings = [];
    } else {
      let start = addDays(date, -((fromISO(date).getDay() + 6) % 7));
      let end = addDays(start, 6);
      // Не перекрываем соседнее расписание, если PDF охватывает неполную неделю.
      for (const w of idx.weeks) {
        if (w.end < date && w.end >= start) start = addDays(w.end, 1);
        if (w.start > date && w.start <= end) end = addDays(w.start, -1);
      }
      week = { id: start, start, end, title: weekTitle(start, end), header: '', source: '',
        days: daysBetween(start, end), events: [], warnings: [], pdf: null };
    }
    index = idx;
    draft = { week, pdf: null, fileName: 'Без загрузки PDF', existing, overlaps: [],
      replaced: existing ? [existing] : [], mode: 'manual' };
    revealPreview();
    if (date) openEditor(null, date);
  } catch (ex) {
    toast(`Не удалось открыть неделю: ${ex.message}`, 6000);
  } finally {
    setBusy(false);
  }
}

/* ---------- загрузка PDF ---------- */

const drop = $('#drop');
$('#file').addEventListener('change', (e) => { if (e.target.files[0]) handleFile(e.target.files[0]); e.target.value = ''; });
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const f = e.dataTransfer.files[0];
  if (f) handleFile(f);
});

async function handleFile(file) {
  if (busy) return;
  if (draft && !confirm('Есть неопубликованные изменения. Отменить их и загрузить новый PDF?')) return;
  setBusy(true);
  const err = $('#parseError');
  err.hidden = true;
  $('.drop-title').textContent = 'Читаю PDF…';
  try {
    const pdf = await file.arrayBuffer();
    const { parseSchedulePdf } = await import('./parser.js');
    const week = await parseSchedulePdf(pdf, file.name);
    index = (await readData(INDEX_PATH)) || { weeks: [] };
    const overlaps = (index?.weeks || []).filter((w) => w.id !== week.id && w.start <= week.end && w.end >= week.start);
    const replaced = (await Promise.all([week.id, ...overlaps.map((w) => w.id)].map((id) => readData(weekPath(id))))).filter(Boolean);
    if ([...overlaps, ...index.weeks.filter((w) => w.id === week.id)].some((w) => !replaced.some((r) => r.id === w.id))) {
      throw new Error('Не удалось загрузить опубликованную неделю. Попробуйте ещё раз.');
    }
    const existing = replaced.find((w) => w.id === week.id) || replaced[0] || null;
    // Добавленные вручную события сохраняем и при исправлении PDF.
    const manualEvents = replaced.flatMap((w) => w.events.filter((e) => e.manual));
    const signatures = new Map(week.events.map((ev, i) => [evSig(ev), i]));
    for (const ev of manualEvents) {
      if (signatures.has(evSig(ev))) {
        const i = signatures.get(evSig(ev));
        week.events[i] = { ...week.events[i], id: ev.id, manual: true };
      } else {
        signatures.set(evSig(ev), week.events.length);
        week.events.push(ev);
      }
    }
    if (manualEvents.length) {
      week.days = [...new Set([...week.days, ...manualEvents.map((e) => e.date).filter(Boolean)])].sort();
      week.start = week.days[0];
      week.end = week.days[week.days.length - 1];
      week.title = weekTitle(week.start, week.end);
    }
    draft = { week, pdf, fileName: file.name, existing, overlaps, replaced, mode: 'pdf' };
    revealPreview();
  } catch (ex) {
    console.error(ex);
    err.textContent = `Не получилось разобрать файл: ${ex.message}`;
    err.hidden = false;
  } finally {
    $('.drop-title').textContent = 'Выберите PDF';
    setBusy(false);
  }
}

/* ---------- предпросмотр ---------- */
const evSig = (e) => [e.date, e.timeText, e.title, e.place, e.tech, e.lines.join('/'), e.scope].join('|');

function diffSummary(cur, prev) {
  const a = new Set(prev.map(evSig));
  const b = new Set(cur.map(evSig));
  const added = cur.filter((e) => !a.has(evSig(e)));
  const removed = prev.filter((e) => !b.has(evSig(e)));
  const changed = added.filter((e) => removed.some((r) => r.date === e.date && r.title === e.title)).length;
  return { added: added.length - changed, removed: removed.length - changed, changed };
}

function personChip(p) {
  const bits = [];
  if (p.from) bits.push(`с ${p.from}`);
  else if (p.times) bits.push(p.times.join(', '));
  if (p.role) bits.push(p.role);
  if (p.note) bits.push(p.note);
  if (p.alts.length) bits.push(`или ${p.alts.join(', ')}`);
  return `<span class="${p.uncertain ? 'q' : ''}">${esc(p.name)}${p.uncertain ? '?' : ''}${bits.length ? ` <i>· ${esc(bits.join(' · '))}</i>` : ''}</span>`;
}

function eventRow(ev) {
  const time = ev.timeText || '—';
  const meta = [ev.place, ev.tech].filter(Boolean).join(' · ');
  const flag = ev.scope === 'people' && !ev.people.length;
  return `<div class="a-ev ${ev.scope === 'note' ? 'note' : ''} ${flag ? 'flag' : ''}" data-ev="${esc(ev.id)}" tabindex="0">
    <div class="t">${esc(time)}</div>
    <div>
      ${ev.scope === 'all' || ev.manual ? `<div class="scope-tag">${[ev.scope === 'all' && 'для всех', ev.manual && 'вручную'].filter(Boolean).join(' · ')}</div>` : ''}
      <div class="ttl">${esc(ev.title || 'Без названия')}</div>
      ${meta ? `<div class="pl">${esc(meta)}</div>` : ''}
      ${ev.people.length ? `<div class="ppl">${ev.people.map(personChip).join('')}</div>` : ''}
    </div>
  </div>`;
}

function renderPreview() {
  const box = $('#preview');
  if (!draft) {
    box.hidden = true;
    $('#publishBar').hidden = true;
    return;
  }
  const { week, existing, overlaps } = draft;
  week.events.sort((a, b) => eventSortKey(a).localeCompare(eventSortKey(b)));
  const people = peopleOfWeek(week);
  const known = new Set((index?.weeks || []).filter((w) => w.id !== week.id).flatMap((w) => w.people || []).map(normName));
  const fresh = known.size ? people.filter((n) => !known.has(normName(n))) : [];

  let status = '<span class="chip ok">Новая неделя</span>';
  let diff = '';
  if (existing) {
    status = `<span class="chip warn">Заменит опубликованную версию ${existing.version || 1}</span>`;
    const d = diffSummary(week.events, existing.events);
    diff = d.added || d.removed || d.changed
      ? `<p class="diff">По сравнению с опубликованной: ${[d.added && `+${d.added} новых`, d.changed && `${d.changed} изменено`, d.removed && `−${d.removed} убрано`].filter(Boolean).join(' · ')}. У людей эти изменения будут отмечены.</p>`
      : '<p class="diff muted">Отличий от опубликованной версии нет.</p>';
  }
  const days = [...new Set([...week.days, ...week.events.map((e) => e.date).filter(Boolean)])].sort();
  const warnings = [...(week.warnings || [])];
  overlaps.forEach((o) => warnings.push(`Даты пересекаются с опубликованной неделей «${o.title}» — она будет заменена этой.`));
  if (fresh.length) warnings.push(`Новые фамилии (проверьте, что это не ошибка распознавания): ${fresh.join(', ')}.`);

  box.hidden = false;
  box.innerHTML = `
    <h2>${esc(week.title)}</h2>
    <div class="summary">${status}<span class="chip">${week.events.filter((e) => e.scope !== 'note').length} событий</span><span class="chip">${people.length} человек</span><span class="chip">${esc(draft.fileName)}</span></div>
    ${diff}
    ${warnings.length ? `<div class="warnings"><b>Проверьте:</b><ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
    <p class="muted" style="font-size:14px">Нажмите на событие, чтобы исправить. Фамилии ниже — так их увидит приложение.</p>
    ${days.map((d) => `
      <div class="a-day"><h3>${esc(weekdayName(d).replace(/^./, (c) => c.toUpperCase()))}, ${esc(fmtDate(d))}</h3><button data-add="${d}">+ событие</button></div>
      ${week.events.filter((e) => e.date === d).map(eventRow).join('')}`).join('')}
    ${week.events.some((e) => !e.date) ? `<div class="a-day"><h3>Без даты</h3></div>${week.events.filter((e) => !e.date).map(eventRow).join('')}` : ''}`;
  $('#publishBar').hidden = false;
  $('#publishBtn').disabled = busy;
}

$('#preview').addEventListener('click', (e) => {
  if (busy) return;
  const add = e.target.closest('[data-add]');
  if (add) return openEditor(null, add.dataset.add);
  const row = e.target.closest('[data-ev]');
  if (row) openEditor(draft.week.events.find((x) => x.id === row.dataset.ev));
});
$('#preview').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('[data-ev]')) e.target.click();
});
$('#discardBtn').addEventListener('click', () => {
  if (busy || !confirm('Отменить неопубликованные изменения?')) return;
  draft = null;
  renderPreview();
});

/* ---------- редактор события ---------- */
const dlg = $('#editDlg');
const ef = $('#editForm');
let editing = null;

function openEditor(ev, date) {
  editing = ev ? ev.id : null;
  const days = [...new Set([...draft.week.days, ...draft.week.events.map((e) => e.date).filter(Boolean), ...(date ? [date] : [])])].sort();
  ef.date.innerHTML = days.map((d) => `<option value="${d}">${esc(fmtDate(d))}, ${esc(weekdayName(d))}</option>`).join('');
  ef.date.value = ev?.date || date || days[0];
  ef.timeText.value = ev?.timeText || '';
  ef.elements.title.value = ev?.title || '';
  ef.elements.title.required = draft.mode === 'manual' || !ev || !!ev.manual;
  ef.elements.title.setCustomValidity('');
  ef.lines.value = (ev?.lines || []).join('\n');
  ef.lines.setCustomValidity('');
  ef.place.value = ev?.place || '';
  ef.timeText.setCustomValidity('');
  ef.tech.value = ev?.tech || '';
  ef.scope.value = ev?.scope || 'people';
  $('#editTitle').textContent = ev ? 'Исправить событие' : 'Новое событие';
  $('#editDelete').hidden = !ev;
  showParsed();
  dlg.showModal();
}

function formEvent() {
  const ev = buildEvent({
    id: editing || `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    date: ef.date.value,
    timeText: ef.timeText.value,
    title: ef.elements.title.value,
    lines: ef.lines.value.split('\n'),
    place: ef.place.value,
    tech: ef.tech.value,
    scope: ef.scope.value,
  });
  if (!editing || draft.week.events.find((e) => e.id === editing)?.manual) ev.manual = true;
  return ev;
}

function showParsed() {
  ef.lines.setCustomValidity('');
  const ev = formEvent();
  $('#editParsed').innerHTML = ev.people.length
    ? `<div class="ppl">${ev.people.map(personChip).join('')}</div>`
    : '<span class="muted" style="font-size:13px">Фамилии не найдены</span>';
}
ef.lines.addEventListener('input', showParsed);
ef.elements.title.addEventListener('input', () => ef.elements.title.setCustomValidity(''));
ef.timeText.addEventListener('input', () => ef.timeText.setCustomValidity(''));
ef.scope.addEventListener('change', () => ef.lines.setCustomValidity(''));
ef.addEventListener('submit', (e) => {
  if (e.submitter?.value !== 'save') return;
  const ev = formEvent();
  if (draft.mode !== 'manual' && !ev.manual) return;
  if (!ev.title) ef.elements.title.setCustomValidity('Укажите название события.');
  if (ev.scope === 'people' && !ev.people.length) ef.lines.setCustomValidity('Укажите фамилии с заглавной буквы или выберите «Всем».');
  const invalidTime = [...ev.timeText.matchAll(/(\d{1,2})[:.](\d{2})/g)].some((m) => Number(m[1]) > 23 || Number(m[2]) > 59);
  if (invalidTime || (ev.timeText && !ev.times.length)) ef.timeText.setCustomValidity('Укажите время, например 12:00, 11:00 13:00 или 12:00 - 14:30.');
  if (!ef.reportValidity()) e.preventDefault();
});

dlg.addEventListener('close', () => {
  const action = dlg.returnValue;
  dlg.returnValue = '';
  if (!draft) return;
  const events = draft.week.events;
  if (action === 'save') {
    const ev = formEvent();
    const i = events.findIndex((x) => x.id === editing);
    if (i >= 0) events[i] = ev;
    else events.push(ev);
  } else if (action === 'delete' && editing) {
    if (!confirm('Удалить это событие?')) return;
    draft.week.events = events.filter((x) => x.id !== editing);
  } else {
    if (draft.mode === 'manual' && !draft.existing && !events.length) {
      draft = null;
      renderPreview();
    }
    return;
  }
  renderPreview();
});

/* ---------- публикация ---------- */

async function commitWeeks({ add = null, pdf = null, remove = [], message }) {
  const idx = (await backend.readJSON(INDEX_PATH)) || { weeks: [] };
  const metas = idx.weeks.filter((w) => !remove.includes(w.id) && (!add || w.id !== add.id));
  if (add) metas.push(indexEntry(add));
  const weeks = (await Promise.all(metas.map((m) => (add && m.id === add.id ? add : backend.readJSON(weekPath(m.id)))))).filter(Boolean);
  const { calendars, files } = buildCalendars(weeks);
  const out = [];
  for (const id of remove) {
    if (await backend.exists(weekPath(id))) out.push({ path: weekPath(id), content: null });
    if (await backend.exists(pdfPath(id))) out.push({ path: pdfPath(id), content: null });
  }
  if (add) {
    if (pdf) out.push({ path: pdfPath(add.id), content: new Uint8Array(pdf) });
    out.push({ path: weekPath(add.id), content: JSON.stringify(add, null, 1) });
  }
  out.push({ path: INDEX_PATH, content: JSON.stringify(buildIndex(metas, calendars), null, 1) });
  out.push(...files);
  await backend.commit(out, message);
}

$('#publishBtn').addEventListener('click', async () => {
  if (!draft || busy) return;
  if (!backend) {
    toast('Сначала подключите GitHub (раздел «Публикация» вверху)', 5000);
    $('#ghPanel').scrollIntoView({ behavior: 'smooth' });
    return;
  }
  const btn = $('#publishBtn');
  setBusy(true);
  btn.textContent = 'Публикую…';
  try {
    const idx = (await backend.readJSON(INDEX_PATH)) || { weeks: [] };
    const ids = [...new Set([draft.week.id, ...draft.replaced.map((w) => w.id)])];
    const current = await Promise.all(ids.map((id) => backend.readJSON(weekPath(id))));
    for (let i = 0; i < ids.length; i++) {
      const before = draft.replaced.find((w) => w.id === ids[i]);
      const now = current[i];
      if (!!before !== !!now || (before && (before.version !== now.version || before.updatedAt !== now.updatedAt))) {
        throw new Error('Расписание уже обновлено. Отмените черновик и откройте неделю заново, чтобы сохранить все изменения.');
      }
    }
    if (idx.weeks.some((w) => w.start <= draft.week.end && w.end >= draft.week.start && !ids.includes(w.id))) {
      throw new Error('На эти даты уже опубликовано другое расписание. Отмените черновик и откройте неделю заново.');
    }
    const existing = current.find((w) => w?.id === draft.week.id) || current.find(Boolean) || null;
    const week = finalizeWeek(draft.week, existing);
    await commitWeeks({
      add: week,
      pdf: draft.pdf,
      remove: draft.overlaps.map((o) => o.id),
      message: `Расписание ${week.title} (версия ${week.version})`,
    });
    draft = null;
    renderPreview();
    await loadPublished();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast(isDev ? 'Сохранено в папку проекта' : 'Опубликовано! В приложении появится через 1–2 минуты.', 6000);
  } catch (ex) {
    console.error(ex);
    toast(`Не удалось опубликовать: ${ex.message}`, 8000);
  } finally {
    setBusy(false);
    btn.textContent = 'Опубликовать';
  }
});

/* ---------- мелочи ---------- */
function toast(text, ms = 3000) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

window.addEventListener('beforeunload', (e) => {
  if (draft) e.preventDefault();
});

setupBackend();
renderGhPanel();
loadPublished();
