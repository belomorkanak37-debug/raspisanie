// Подготовка файлов данных и публикация в репозиторий GitHub (через GitHub API).

import { addDays, buildICS, normName, peopleOfWeek, personalItems, todayISO, translit } from './core.js';

export const weekPath = (id) => `data/weeks/${id}.json`;
export const pdfPath = (id) => `data/pdf/${id}.pdf`;
export const INDEX_PATH = 'data/index.json';

// Неделя для сохранения. Предыдущая версия хранится, чтобы показывать «изменилось».
export function finalizeWeek(draft, existing) {
  const { warnings, ...week } = draft;
  return {
    ...week,
    version: existing ? (existing.version || 1) + 1 : 1,
    updatedAt: new Date().toISOString(),
    pdf: week.pdf === undefined ? pdfPath(week.id) : week.pdf,
    previous: existing ? { version: existing.version || 1, updatedAt: existing.updatedAt, events: existing.events } : null,
  };
}

export function indexEntry(week) {
  return {
    id: week.id, start: week.start, end: week.end, title: week.title,
    version: week.version, updatedAt: week.updatedAt, pdf: week.pdf, people: peopleOfWeek(week),
  };
}

// Персональные календари для подписки (обновляются сами при каждой публикации).
export function buildCalendars(weeks) {
  const since = addDays(todayISO(), -60);
  const names = new Map();
  for (const w of weeks) for (const n of peopleOfWeek(w)) if (!names.has(normName(n))) names.set(normName(n), n);
  const used = new Set();
  const calendars = {};
  const files = [];
  for (const [key, name] of [...names].sort((a, b) => a[0].localeCompare(b[0], 'ru'))) {
    let slug = translit(name);
    let k = 2;
    while (used.has(slug)) slug = `${translit(name)}-${k++}`;
    used.add(slug);
    const items = weeks.filter((w) => w.end >= since)
      .flatMap((w) => personalItems(w.events, key))
      .filter((it) => it.type !== 'note' && it.ev.date >= since);
    const path = `data/ics/${slug}.ics`;
    calendars[key] = path;
    files.push({ path, content: buildICS(items, `Расписание — ${name}`) });
  }
  return { calendars, files };
}

export function buildIndex(weeksMeta, calendars) {
  return {
    updatedAt: new Date().toISOString(),
    weeks: [...weeksMeta].sort((a, b) => a.start.localeCompare(b.start)),
    calendars,
  };
}

/* ---------- GitHub API ---------- */

function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function base64ToText(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export class GitHub {
  constructor({ owner, repo, branch, token }) {
    Object.assign(this, { owner, repo, branch: branch || 'main', token });
  }

  async req(method, path, body) {
    const res = await fetch(`https://api.github.com/repos/${this.owner}/${this.repo}${path}`, {
      method,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      let msg = `${res.status}`;
      try { msg += ` ${(await res.json()).message}`; } catch { /* ignore */ }
      if (res.status === 401) msg = 'Ключ доступа недействителен или просрочен (401).';
      if (res.status === 403) msg = `Нет прав на запись в репозиторий (403). ${msg}`;
      throw new Error(msg);
    }
    return res.status === 204 ? {} : res.json();
  }

  async check() {
    const repo = await this.req('GET', '');
    if (!repo) throw new Error(`Репозиторий ${this.owner}/${this.repo} не найден или ключ не даёт к нему доступа.`);
    if (repo.permissions && !repo.permissions.push) throw new Error('У ключа нет права записи (Contents: Read and write).');
    return repo;
  }

  async readJSON(path) {
    const file = await this.req('GET', `/contents/${path}?ref=${encodeURIComponent(this.branch)}`);
    if (!file) return null;
    if (file.content) return JSON.parse(base64ToText(file.content));
    const blob = await this.req('GET', `/git/blobs/${file.sha}`);
    return JSON.parse(base64ToText(blob.content));
  }

  async exists(path) {
    const dir = path.split('/').slice(0, -1).join('/');
    const name = path.split('/').pop();
    const list = await this.req('GET', `/contents/${dir}?ref=${encodeURIComponent(this.branch)}`);
    return Array.isArray(list) && list.some((f) => f.name === name);
  }

  // Один коммит со всеми файлами. content: строка, Uint8Array или null (удалить файл).
  async commit(files, message) {
    const ref = await this.req('GET', `/git/ref/heads/${encodeURIComponent(this.branch)}`);
    if (!ref) throw new Error(`Ветка «${this.branch}» не найдена. Сначала загрузите файлы приложения в репозиторий.`);
    const parent = ref.object.sha;
    const base = await this.req('GET', `/git/commits/${parent}`);
    const tree = [];
    for (const f of files) {
      if (f.content === null) {
        tree.push({ path: f.path, mode: '100644', type: 'blob', sha: null });
      } else if (typeof f.content === 'string') {
        tree.push({ path: f.path, mode: '100644', type: 'blob', content: f.content });
      } else {
        const blob = await this.req('POST', '/git/blobs', { content: bytesToBase64(f.content), encoding: 'base64' });
        tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
      }
    }
    const newTree = await this.req('POST', '/git/trees', { base_tree: base.tree.sha, tree });
    const c = await this.req('POST', '/git/commits', { message, tree: newTree.sha, parents: [parent] });
    await this.req('PATCH', `/git/refs/heads/${encodeURIComponent(this.branch)}`, { sha: c.sha });
    return c.sha;
  }
}
