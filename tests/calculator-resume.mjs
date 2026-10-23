import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import * as core from '../js/core.js';

class Element {
  value = ''; innerHTML = ''; attrs = new Map(); listeners = new Map();
  constructor(selector) { this.selector = selector; }
  addEventListener(type, fn) { this.listeners.set(type, [...this.listeners.get(type) || [], fn]); }
  async emit(type, event = {}) { for (const fn of this.listeners.get(type) || []) await fn({ target: this, ...event }); }
  setAttribute(key, value) { this.attrs.set(key, value); }
  matches(selector) { return selector.split(',').some((s) => s.trim() === this.selector); }
}

const elements = new Map();
const get = (selector) => { if (!elements.has(selector)) elements.set(selector, new Element(selector)); return elements.get(selector); };
const storage = new Map(), frames = [], winListeners = new Map(), docListeners = new Map();
const document = {
  visibilityState: 'visible', querySelector: get, querySelectorAll: () => [],
  addEventListener(type, fn) { docListeners.set(type, [...docListeners.get(type) || [], fn]); },
};
const window = { addEventListener(type, fn) { winListeners.set(type, [...winListeners.get(type) || [], fn]); } };
const context = vm.createContext({
  document, window, navigator: {}, location: { hash: '#/p/test', protocol: 'http:' },
  localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  requestAnimationFrame: (fn) => frames.push(fn), console,
  fetch() { throw Error('Calculator resume must not fetch fresh schedules unnecessarily'); },
});
const coreModule = new vm.SyntheticModule(Object.keys(core), function () {
  for (const [key, value] of Object.entries(core)) this.setExport(key, value);
}, { context });
await coreModule.link(() => {}); await coreModule.evaluate();
const personalModule = new vm.SourceTextModule(await fs.readFile(new URL('../js/personal.js', import.meta.url), 'utf8'), { context });
await personalModule.link(() => coreModule); await personalModule.evaluate();
const source = (await fs.readFile(new URL('../js/app.js', import.meta.url), 'utf8')).replace('\nroute();\n', '\n');
const app = new vm.SourceTextModule(source + '\nexport {state,bindFeed,updateSalaryResult};export const setPerson=p=>current=p;', { context });
await app.link((name) => name === './core.js' ? coreModule : personalModule); await app.evaluate();
const { state, bindFeed, updateSalaryResult, setPerson } = app.namespace;
const person = { name: 'Проверка', key: 'проверка', known: true };
const totals = core.monthlyTotals([], person.key, '2026-10');
setPerson(person); state.view = 'calculator'; state.totalsMonth = '2026-10';
state.index = { weeks: [] }; state.loadedAt = Date.now(); state.salaryTotals = { person, ym: '2026-10', totals };
const salary = get('[data-salary]'), advance = get('[data-advance]'), result = get('#salaryResult'), feed = get('#feed');
bindFeed(feed);
const emit = async (listeners, type) => { for (const fn of listeners.get(type) || []) await fn(); };
const flushFrames = () => { while (frames.length) frames.shift()(); };
const money = (n) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(n);

salary.value = '50000'; advance.value = '10000'; updateSalaryResult();
assert.ok(result.innerHTML.includes(`<strong>${money(33500)}</strong>`));
// A mobile browser may restore the visible field without an input event.
advance.value = '';
await emit(docListeners, 'visibilitychange'); flushFrames();
assert.ok(result.innerHTML.includes(`<strong>${money(43500)}</strong>`), 'Returning to the app must discard a stale advance deduction');
assert.equal(storage.get('rs.advance.v1.проверка.2026-10'), JSON.stringify(''));
console.log('PASS: returning to a visible app recalculates the restored empty advance');

advance.value = '10000'; await feed.emit('input', { target: advance });
advance.value = ''; await emit(winListeners, 'pageshow'); flushFrames();
assert.ok(result.innerHTML.includes(`<strong>${money(43500)}</strong>`));
advance.value = '10000'; await feed.emit('input', { target: advance });
await emit(winListeners, 'pageshow');
advance.value = ''; flushFrames();
assert.ok(result.innerHTML.includes(`<strong>${money(43500)}</strong>`));
console.log('PASS: cached-page restore recalculates both immediately and after restored form values');

advance.value = '10000'; await feed.emit('input', { target: advance });
advance.value = ''; await feed.emit('change', { target: advance });
assert.ok(result.innerHTML.includes(`<strong>${money(43500)}</strong>`));
assert.equal(storage.get('rs.advance.v1.проверка.2026-10'), JSON.stringify(''));
advance.value = '10000'; await feed.emit('input', { target: advance });
advance.value = ''; await emit(winListeners, 'focus'); flushFrames();
assert.ok(result.innerHTML.includes(`<strong>${money(43500)}</strong>`));
console.log('PASS: change-only clearing and app focus restore the full amount');

advance.value = ''; salary.value = '60000'; document.visibilityState = 'hidden';
await emit(docListeners, 'visibilitychange');
assert.equal(storage.get('rs.salary.v1.проверка'), JSON.stringify('60000'));
assert.equal(storage.get('rs.advance.v1.проверка.2026-10'), JSON.stringify(''));
assert.equal(frames.length, 0);
const stored = [...storage];
setPerson({ name: 'Другой', key: 'другой', known: true });
document.visibilityState = 'visible'; await emit(winListeners, 'pageshow'); flushFrames();
assert.deepEqual([...storage], stored);
console.log('PASS: visible input is saved on backgrounding; stale fields cannot overwrite another surname');
