import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import * as core from '../js/core.js';

const context = vm.createContext({
  document: { addEventListener() {}, querySelector() { return { addEventListener() {} }; } }, window: { addEventListener() {} },
  navigator: {}, location: { hash: '', protocol: 'http:' }, console,
  localStorage: { getItem() { return null; }, setItem() {} },
});
const coreModule = new vm.SyntheticModule(Object.keys(core), function () {
  for (const [key, value] of Object.entries(core)) this.setExport(key, value);
}, { context });
await coreModule.link(() => {}); await coreModule.evaluate();
const personalModule = new vm.SourceTextModule(await fs.readFile(new URL('../js/personal.js', import.meta.url), 'utf8'), { context });
await personalModule.link(() => coreModule); await personalModule.evaluate();
const source = (await fs.readFile(new URL('../js/app.js', import.meta.url), 'utf8')).replace('\nroute();\n', '\n');
const app = new vm.SourceTextModule(source + '\nexport { weekEntries };', { context });
await app.link((name) => name === './core.js' ? coreModule : personalModule); await app.evaluate();

const event = (id, title, timeText = '18:30') => core.buildEvent({
  id, date: '2026-11-29', timeText, title, lines: ['Безносиков'],
});
const prior = event('manual', 'Детская студия');
const updated = event('manual', 'Хочу стать кукловодом – ст. группа');
const replacement = event('pdf', 'Хочу стать кукловодом – ст. группа');
const entries = (events, previous) => app.namespace.weekEntries({ id: 'week', events, previous: { events: previous } }, 'безносиков', () => true);

for (const current of [updated, replacement]) {
  const result = entries([current], [prior]);
  assert.equal(result.length, 1);
  assert.equal(result[0].ev.title, current.title);
  assert.ok(!result[0].removed);
}
assert.equal(entries([], [prior]).length, 0, 'Removed events are absent from the public views');
assert.equal(entries([replacement], [replacement, prior]).length, 1, 'An existing replacement does not leave an old canceled card');
const changedTime = entries([event('manual', 'Детская студия', '19:00')], [prior]);
assert.equal(changedTime[0].change.type, 'changed');
console.log('PASS: list and calendar receive only current entries, including edits and replacements');
