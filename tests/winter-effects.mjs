import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import * as physics from '../js/winter-physics.js';

const bank = physics.makeBank(400, 42, 4);
const before = physics.snowHeight(bank, 200);
physics.depositSnow(bank, 200, 3);
assert.ok(physics.snowHeight(bank, 200) > before);
assert.equal(physics.snowHeight(bank, 0), 4);
for (let i = 0; i < 10000; i++) physics.depositSnow(bank, i % 401, 4);
assert.ok(bank.heights.every((v) => Number.isFinite(v) && v <= 42));
const capped = [...bank.heights];
physics.depositSnow(bank, -20); physics.depositSnow(bank, 450);
assert.deepEqual(bank.heights, capped);
console.log('PASS: snow accumulates locally, ignores outside hits and cannot cover the screen');

class Element {
  hidden = false; disabled = false; dataset = {}; textContent = ''; listeners = new Map(); attrs = new Map(); classes = new Set();
  classList = { add: (c) => this.classes.add(c), remove: (c) => this.classes.delete(c), toggle: (c, on) => on ? this.classes.add(c) : this.classes.delete(c) };
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  fire(type) { this.listeners.get(type)?.(); }
  setAttribute(k, v) { this.attrs.set(k, v); }
  getBoundingClientRect() { return { x: 0, y: 500, width: 115, height: 145 }; }
  contains(el) { return this === el; }
  matches() { return false; }
}
const elements = new Map();
const get = (s) => { if (!elements.has(s)) elements.set(s, new Element()); return elements.get(s); };
const frames = new Map(), storage = new Map(), events = new Map();
let serial = 0, now = 0, dialogOpen = false;
const reduced = { matches: false, addEventListener(_, fn) { this.listener = fn; } };
const document = { hidden: false, activeElement: null, documentElement: new Element(),
  querySelector: (s) => s === 'dialog[open]' ? (dialogOpen ? {} : null) : get(s), querySelectorAll: () => [],
  addEventListener: (type, fn) => events.set(type, fn) };
get('#winterCanvas').getContext = () => new Proxy({}, { get: () => () => {} });
const context = vm.createContext({
  document, window: { innerWidth: 390, innerHeight: 844, addEventListener() {} },
  matchMedia: (q) => q.includes('reduced-motion') ? reduced : { matches: false, addEventListener() {} },
  MutationObserver: class { observe() {} }, performance: { now: () => now }, devicePixelRatio: 2,
  localStorage: { getItem: (k) => storage.get(k), setItem: (k, v) => storage.set(k, v) },
  requestAnimationFrame: (fn) => { frames.set(++serial, fn); return serial; }, cancelAnimationFrame: (id) => frames.delete(id), queueMicrotask,
});
const module = new vm.SyntheticModule(Object.keys(physics), function () {
  for (const [key, value] of Object.entries(physics)) this.setExport(key, value);
}, { context });
await module.link(() => {}); await module.evaluate();
const app = new vm.SourceTextModule(await fs.readFile(new URL('../js/winter.js', import.meta.url), 'utf8'), { context });
await app.link(() => module); await app.evaluate();
function advance(count) { for (let i = 0; i < count; i++) { now += 34; const work = [...frames.values()]; frames.clear(); work.forEach((f) => f(now)); } }
advance(90);
assert.equal(get('#winterVisitor').hidden, false);
assert.equal(get('#winterBubble').textContent, 'Новогодка близко');
get('#winterCharacter').fire('click');
assert.match(get('#winterAnnouncement').textContent, /Поймал/);
assert.equal(frames.size, 1);
get('#winterMode').fire('click');
assert.equal(get('#winterModeName').textContent, 'Бегущие огни');
document.hidden = true; events.get('visibilitychange')();
assert.equal(frames.size, 0); assert.equal(get('#winterScene').hidden, true);
document.hidden = false; events.get('visibilitychange')();
assert.equal(frames.size, 1);
document.activeElement = { matches: () => true }; events.get('focusin')();
assert.equal(frames.size, 0); assert.equal(get('#winterScene').hidden, true);
document.activeElement = null; events.get('focusin')();
dialogOpen = true; events.get('focusin')();
assert.equal(frames.size, 0); assert.equal(get('#winterScene').hidden, true);
dialogOpen = false; events.get('focusin')();
get('#winterToggle').fire('click');
assert.equal(storage.get('rs.winter.enabled'), 'false');
assert.equal(frames.size, 0); assert.equal(get('#winterScene').hidden, true);
get('#winterToggle').fire('click');
reduced.matches = true; reduced.listener();
assert.equal(frames.size, 0);
assert.equal(get('#winterScene').hidden, false);
console.log('PASS: character replies and light modes work; effects stop when hidden, editing, disabled or reduced-motion is enabled');
