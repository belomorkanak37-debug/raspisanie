// Разбор PDF-расписания (таблица из Word) прямо в браузере.
// Ячейки таблицы восстанавливаются по линиям рамок, текст раскладывается по колонкам:
// День | Дата | Начало | Спектакль / РПТ | Сцена | Звук, свет.

import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
import { buildEvent, detectYearMonth, eventSortKey, resolveDate, weekTitle } from './core.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
const OPS = pdfjsLib.OPS;

const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

// Прямоугольники/отрезки из операторов рисования → координаты страницы (y вниз).
function collectBoxes(opList, viewport) {
  const boxes = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const toPage = (x, y) => viewport.convertToViewportPoint(...apply(ctm, x, y));
  const pushBox = (pts) => {
    const p = pts.map(([x, y]) => toPage(x, y));
    const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
    boxes.push({ x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) });
  };
  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = mul(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      if (Array.isArray(args[0]) && args[0].length === 6) ctm = mul(ctm, args[0]);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.constructPath) {
      const [ops, coords] = args;
      if (!Array.isArray(ops)) continue;
      let k = 0;
      let sub = [];
      const flush = () => { if (sub.length > 1) pushBox(sub); sub = []; };
      for (const op of ops) {
        if (op === OPS.rectangle) {
          flush();
          const [x, y, w, h] = coords.slice(k, k + 4);
          k += 4;
          pushBox([[x, y], [x + w, y + h]]);
        } else if (op === OPS.moveTo) {
          flush();
          sub.push([coords[k], coords[k + 1]]);
          k += 2;
        } else if (op === OPS.lineTo) {
          sub.push([coords[k], coords[k + 1]]);
          k += 2;
        } else if (op === OPS.curveTo) k += 6;
        else if (op === OPS.curveTo2 || op === OPS.curveTo3) k += 4;
        else if (op === OPS.closePath) { /* nothing */ }
      }
      flush();
    }
  }
  return boxes;
}

async function readPage(page) {
  const viewport = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const items = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const [, , c, d, e, f] = it.transform;
    const h = Math.hypot(c, d) || it.height || 10;
    const [x0, base] = viewport.convertToViewportPoint(e, f);
    const [x1] = viewport.convertToViewportPoint(e + it.width, f);
    items.push({ str: it.str, x0: Math.min(x0, x1), x1: Math.max(x0, x1), base, h, cy: base - h * 0.35 });
  }
  const boxes = collectBoxes(await page.getOperatorList(), viewport);
  const hSegs = [], vSegs = [];
  for (const b of boxes) {
    const w = b.x1 - b.x0, h = b.y1 - b.y0;
    if (h <= 2.5 && w >= 3) hSegs.push({ y: (b.y0 + b.y1) / 2, x0: b.x0, x1: b.x1 });
    else if (w <= 2.5 && h >= 3) vSegs.push({ x: (b.x0 + b.x1) / 2, y0: b.y0, y1: b.y1 });
  }
  return { items, hSegs, vSegs, width: viewport.width, height: viewport.height };
}

function columnBoundaries(vSegs) {
  if (!vSegs.length) return null;
  const sorted = [...vSegs].sort((a, b) => a.x - b.x);
  const clusters = [];
  for (const s of sorted) {
    const c = clusters[clusters.length - 1];
    if (c && s.x - c.x <= 2.5) {
      c.len += s.y1 - s.y0;
      c.x = (c.x * c.n + s.x) / (c.n + 1);
      c.n++;
    } else clusters.push({ x: s.x, len: s.y1 - s.y0, n: 1 });
  }
  const top = Math.min(...vSegs.map((s) => s.y0)), bottom = Math.max(...vSegs.map((s) => s.y1));
  const xs = clusters.filter((c) => c.len >= 0.3 * (bottom - top)).map((c) => c.x);
  return xs.length >= 4 ? xs : null;
}

// Определяем, какая колонка что содержит, по её содержимому.
function labelColumns(bounds, items) {
  const cols = [];
  for (let i = 0; i < bounds.length - 1; i++) cols.push({ x0: bounds[i], x1: bounds[i + 1], items: [] });
  for (const it of items) {
    const cx = (it.x0 + it.x1) / 2;
    const col = cols.find((c) => cx >= c.x0 && cx < c.x1);
    if (col) col.items.push(it);
  }
  const score = (c, re) => c.items.filter((it) => re.test(it.str)).length;
  const len = (c) => c.items.reduce((s, it) => s + it.str.trim().length, 0);
  const idx = (arr, f) => arr.reduce((best, c, i) => (f(c) > f(arr[best]) ? i : best), 0);

  const ev = idx(cols, len);
  const left = cols.slice(0, ev);
  const time = left.length ? idx(left, (c) => score(c, /^\s*\d{1,2}[:.]\d{2}/)) : -1;
  const date = time > 0 ? idx(cols.slice(0, time), (c) => score(c, /\d{1,2}\.\d{1,2}(?!\d|:)/)) : -1;
  const right = cols.slice(ev + 1);
  let place = ev + 1 < cols.length ? ev + 1 : -1;
  let tech = ev + 2 < cols.length ? ev + 2 : -1;
  if (right.length >= 2) {
    const p = idx(right, (c) => score(c, /сцен|фойе|зал|вокзал/i));
    const t = idx(right, (c) => score(c, /звук|свет/i));
    if (p !== t) { place = ev + 1 + p; tech = ev + 1 + t; }
  }
  const pick = (i) => (i >= 0 ? { x0: cols[i].x0, x1: cols[i].x1 } : null);
  return {
    day: date > 0 ? { x0: cols[0].x0, x1: cols[date].x0 } : null,
    date: pick(date), time: pick(time), event: pick(ev), place: pick(place), tech: pick(tech),
  };
}

// Типовая раскладка шаблона — на случай, если в PDF нет линий таблицы.
function fallbackColumns(width) {
  const r = (v) => (v / 841.92) * width;
  return {
    day: { x0: r(20), x1: r(112.5) }, date: { x0: r(112.5), x1: r(148) }, time: { x0: r(148), x1: r(197.5) },
    event: { x0: r(197.5), x1: r(644) }, place: { x0: r(644), x1: r(736.3) }, tech: { x0: r(736.3), x1: r(822) },
  };
}

// Горизонтальные линии, которые полностью пересекают колонку (подчёркивания текста отсекаются).
function separatorsAcross(hSegs, col) {
  if (!col) return [];
  const a = col.x0 + 4, b = col.x1 - 4;
  const groups = [];
  for (const s of [...hSegs].sort((p, q) => p.y - q.y)) {
    const g = groups[groups.length - 1];
    if (g && s.y - g.y <= 1.5) g.segs.push(s);
    else groups.push({ y: s.y, segs: [s] });
  }
  const ys = [];
  for (const g of groups) {
    const segs = g.segs.filter((s) => s.x1 > a && s.x0 < b).sort((p, q) => p.x0 - q.x0);
    let reach = a;
    for (const s of segs) if (s.x0 <= reach + 2) reach = Math.max(reach, s.x1);
    if (reach >= b) ys.push(g.y);
  }
  return ys;
}

const inCol = (it, col) => col && (it.x0 + it.x1) / 2 >= col.x0 && (it.x0 + it.x1) / 2 < col.x1;

// Элементы текста → строки { text, cy } (сверху вниз, слева направо).
function toLines(items) {
  const sorted = [...items].sort((a, b) => a.base - b.base || a.x0 - b.x0);
  const lines = [];
  for (const it of sorted) {
    const l = lines[lines.length - 1];
    if (l && Math.abs(it.base - l.base) <= 2.5) l.items.push(it);
    else lines.push({ base: it.base, cy: it.cy, items: [it] });
  }
  return lines.map((l) => {
    let text = '';
    let prevX1 = null;
    for (const it of l.items.sort((a, b) => a.x0 - b.x0)) {
      if (prevX1 !== null && it.x0 - prevX1 > it.h * 0.2 && !/\s$/.test(text) && !/^\s/.test(it.str)) text += ' ';
      text += it.str;
      prevX1 = it.x1;
    }
    return { text: text.replace(/ /g, ' ').replace(/\s+/g, ' ').trim(), cy: l.cy };
  }).filter((l) => l.text);
}

// Строка, с которой начинается новое событие («Спектакль «…»», «Репетиция …»).
const TITLE_START = /^(спектакль|репетиция|ввод|сдача|собрание|прогон|отъезд|выезд|выходной)(?=[\s«:]|$)/i;

// Иногда в одну ячейку таблицы вписаны два события подряд — делим их,
// а время из колонки «Начало» раздаём по высоте строки.
function splitBand(evLines, timeLines) {
  const starts = [0];
  evLines.forEach((l, i) => { if (i > 0 && TITLE_START.test(l.text)) starts.push(i); });
  const open = (s) => s.lastIndexOf('«') > s.lastIndexOf('»');
  return starts.map((s, n) => {
    const end = n + 1 < starts.length ? starts[n + 1] : evLines.length;
    const part = evLines.slice(s, end).map((l) => l.text);
    let k = 1;
    let title = part[0] || '';
    while (open(title) && k < part.length) title += ` ${part[k++]}`;
    const top = n === 0 ? -Infinity : evLines[s].cy - 3;
    const bottom = n + 1 < starts.length ? evLines[starts[n + 1]].cy - 3 : Infinity;
    const times = starts.length === 1 ? timeLines : timeLines.filter((t) => t.cy >= top && t.cy < bottom);
    return { title, lines: part.slice(k), timeText: times.map((t) => t.text).join(' ') };
  });
}

const HEADER_RE = /спектакль\s*\/\s*рпт|^начало$/i;

export async function parseSchedulePdf(buffer, fileName = '') {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) pages.push(await readPage(await doc.getPage(n)));

  const fullText = pages.flatMap((p) => p.items.map((i) => i.str)).join(' ');
  const hint = detectYearMonth(fullText);
  const headerLine = (fullText.match(/ПЛАН\s+РАБОТЫ[^А-ЯЁ]*На\s+[А-ЯЁ]+\s+\d{4}\s*года/i) || [''])[0];
  const warnings = [];
  if (!hint) warnings.push('Не нашёл в шапке месяц и год («На ОКТЯБРЬ 2026 года») — год определён по текущей дате.');

  const rawEvents = [];
  const dates = new Set();
  let cols = null;
  let lastDate = null;

  for (const page of pages) {
    if (!page.items.length) continue;
    const bounds = columnBoundaries(page.vSegs);
    cols = bounds ? labelColumns(bounds, page.items) : cols || fallbackColumns(page.width);
    if (!bounds && !page.hSegs.length) {
      warnings.push('В PDF не найдены линии таблицы — разбор может быть неточным, проверьте результат.');
    }

    // Полосы дней (по линиям, пересекающим колонку «Дата»).
    const dateSeps = separatorsAcross(page.hSegs, cols.date);
    const leftEdge = cols.time ? cols.time.x0 : cols.event.x0;
    // Дата может быть разбита на куски («28» + «.09»), поэтому ищем её в склеенных строках.
    const dateItems = toLines(page.items.filter((it) => (it.x0 + it.x1) / 2 < leftEdge))
      .filter((l) => /\d{1,2}\.\d{1,2}/.test(l.text));
    const dateOf = (l) => {
      const m = /(\d{1,2})\.(\d{1,2})/.exec(l.text);
      return resolveDate(Number(m[1]), Number(m[2]), hint);
    };
    const dayBands = [];
    for (let i = 0; i < dateSeps.length - 1; i++) {
      const a = dateSeps[i], b = dateSeps[i + 1];
      if (b - a < 4) continue;
      const it = dateItems.find((d) => d.cy > a && d.cy < b);
      if (it) lastDate = dateOf(it);
      if (lastDate && (it || dayBands.length || rawEvents.length)) dayBands.push({ a, b, date: lastDate });
      if (it) dates.add(lastDate);
    }
    if (!dayBands.length) dateItems.forEach((d) => dates.add(dateOf(d)));
    const dateFor = (y) => {
      const band = dayBands.find((d) => y > d.a && y < d.b);
      if (band) return band.date;
      if (dateItems.length) {
        const near = dateItems.reduce((p, q) => (Math.abs(q.cy - y) < Math.abs(p.cy - y) ? q : p));
        return dateOf(near);
      }
      return lastDate;
    };

    // Ячейки «Сцена» и «Звук, свет» бывают объединены на несколько строк —
    // берём текст той объединённой ячейки, в которую попадает строка события.
    const cellText = (col) => {
      if (!col) return () => '';
      const ys = separatorsAcross(page.hSegs, col);
      const colItems = page.items.filter((it) => inCol(it, col));
      return (a, b) => {
        const mid = (a + b) / 2;
        let top = a, bottom = b;
        for (let i = 0; i < ys.length - 1; i++) {
          if (mid > ys[i] && mid < ys[i + 1]) { top = ys[i]; bottom = ys[i + 1]; break; }
        }
        return toLines(colItems.filter((it) => it.cy > top && it.cy < bottom)).map((l) => l.text).join(' ');
      };
    };
    const placeAt = cellText(cols.place);
    const techAt = cellText(cols.tech);

    // Полосы событий (по линиям, пересекающим колонку «Спектакль / РПТ»).
    const seps = separatorsAcross(page.hSegs, cols.event);
    for (let i = 0; i < seps.length - 1; i++) {
      const a = seps[i], b = seps[i + 1];
      if (b - a < 4) continue;
      const inBand = page.items.filter((it) => it.cy > a && it.cy < b);
      const pick = (col) => toLines(inBand.filter((it) => inCol(it, col)));
      const evLines = pick(cols.event);
      // «Начало в 10:00 и 12:00» бывает временем настоящего выездного спектакля.
      // Одно слово «Начало» в этой ячейке не означает, что вся строка — шапка.
      const timeLines = pick(cols.time).filter((l) => !/^начало$/i.test(l.text));
      if (evLines.some((l) => HEADER_RE.test(l.text))) continue;
      if (!evLines.length && !timeLines.length) continue;

      const date = dateFor((a + b) / 2);
      const place = placeAt(a, b);
      const tech = techAt(a, b);
      for (const part of splitBand(evLines, timeLines)) rawEvents.push({ date, place, tech, ...part });
    }
  }

  const allDates = [...dates].sort();
  if (!allDates.length) throw new Error('Не удалось найти даты в PDF. Это точно расписание в привычном формате?');
  const start = allDates[0], end = allDates[allDates.length - 1];
  const events = rawEvents.map((r) => buildEvent(r)).sort((x, y) => eventSortKey(x).localeCompare(eventSortKey(y)));
  events.forEach((ev, i) => { ev.id = `e${i + 1}`; });

  for (const ev of events) {
    const what = `${ev.date || '?'} ${ev.timeText || ''} «${ev.title || 'без названия'}»`;
    if (!ev.date) warnings.push(`Не определилась дата: ${what}`);
    if (ev.timeText && !ev.times.length) warnings.push(`Не распознано время «${ev.timeText}»: ${what}`);
    if (ev.scope === 'people' && !ev.people.length) warnings.push(`Нет участников — событие никому не покажется: ${what}`);
    if (!ev.title) warnings.push(`Пустое название: ${what}`);
  }

  return {
    id: start, start, end, title: weekTitle(start, end),
    header: headerLine.replace(/\s+/g, ' ').trim(), source: fileName,
    days: allDates, events, warnings,
  };
}
