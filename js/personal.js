// Личные дела хранятся только в localStorage этого браузера, отдельно для каждой фамилии.
import { normName } from './core.js';

export const PERSONAL_PREFIX = 'rs.personalEvents.v1.';
export const personalStorageKey = (name) => `${PERSONAL_PREFIX}${normName(name)}`;

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1900) return false;
  const d = new Date(`${value}T12:00:00`);
  return !isNaN(d) && d.getFullYear() === Number(value.slice(0, 4))
    && d.getMonth() + 1 === Number(value.slice(5, 7)) && d.getDate() === Number(value.slice(8));
}

export function validatePersonalEvent(input) {
  const text = (field) => String(input?.[field] ?? '').trim();
  const event = {
    id: text('id'), date: text('date'), title: text('title'),
    start: text('start'), end: text('end'), place: text('place'), note: text('note'),
  };
  if (!validDate(event.date)) throw new Error('Выберите корректную дату.');
  if (!event.title || event.title.length > 200) throw new Error('Укажите название дела — до 200 символов.');
  const validTime = (t) => !t || /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t);
  if (!validTime(event.start) || !validTime(event.end)) throw new Error('Укажите корректное время.');
  if (event.end && !event.start) throw new Error('Укажите время начала или оставьте оба поля времени пустыми.');
  if (event.end && event.end <= event.start) throw new Error('Окончание должно быть позже начала в тот же день.');
  if (event.place.length > 200 || event.note.length > 2000) throw new Error('Место — до 200 символов, заметка — до 2000.');
  if (event.id && !/^[a-zA-Z0-9-]{1,80}$/.test(event.id)) throw new Error('Не удалось определить личное дело.');
  return event;
}

export function loadPersonalEvents(name, storage) {
  try {
    const raw = (storage || localStorage).getItem(personalStorageKey(name));
    if (raw === null) return [];
    const events = JSON.parse(raw);
    if (!Array.isArray(events)) throw new Error('Invalid data');
    const ids = new Set();
    return events.map((rawEvent) => {
      const event = validatePersonalEvent(rawEvent);
      if (!event.id || ids.has(event.id)) throw new Error('Invalid id');
      ids.add(event.id);
      return event;
    }).sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`));
  } catch {
    throw new Error('Не удалось прочитать личные дела в этом браузере. Сохранение изменений пока недоступно.');
  }
}

function writeEvents(name, events, storage) {
  try { (storage || localStorage).setItem(personalStorageKey(name), JSON.stringify(events)); }
  catch { throw new Error('Не удалось сохранить личные дела. Проверьте, доступно ли хранение данных в браузере, и попробуйте ещё раз.'); }
}

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `l${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function savePersonalEvent(name, input, storage) {
  const event = validatePersonalEvent(input);
  const events = loadPersonalEvents(name, storage);
  if (event.id) {
    const i = events.findIndex((e) => e.id === event.id);
    if (i < 0) throw new Error('Это личное дело уже удалено. Закройте форму и обновите календарь.');
    events[i] = event;
  } else {
    do { event.id = newId(); } while (events.some((e) => e.id === event.id));
    events.push(event);
  }
  writeEvents(name, events, storage);
  return event;
}

export function deletePersonalEvent(name, id, storage) {
  const events = loadPersonalEvents(name, storage);
  const event = events.find((e) => e.id === id);
  if (!event) throw new Error('Это личное дело уже удалено. Закройте форму и обновите календарь.');
  writeEvents(name, events.filter((e) => e.id !== id), storage);
  return event;
}
