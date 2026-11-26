// Rebuild only weeks whose combined PDF rows contain interludes. Idempotent.
import fs from 'node:fs';
import { expandInterludes } from '../js/core.js';
import { finalizeWeek, indexEntry, buildCalendars, buildIndex } from '../js/publish.js';
const root = new URL('../', import.meta.url);
const read = p => JSON.parse(fs.readFileSync(new URL(p, root)));
const write = (p, content) => fs.writeFileSync(new URL(p, root), content);
const index = read('data/index.json');
let changed = 0;
const weeks = index.weeks.map(meta => {
  const p = `data/weeks/${meta.id}.json`, old = read(p);
  const events = old.events.flatMap(expandInterludes);
  if (JSON.stringify(events) === JSON.stringify(old.events)) return old;
  const next = finalizeWeek({ ...old, events }, old);
  write(p, JSON.stringify(next, null, 1) + '\n');
  console.log(`Updated ${meta.id}: ${old.events.length} → ${events.length} events`);
  changed++;
  return next;
});
if (changed) {
  const { calendars, files } = buildCalendars(weeks);
  const stable = s => s.replace(/^DTSTAMP:.*\r?\n/gm, '');
  for (const f of files) {
    const p = new URL(f.path, root);
    if (!fs.existsSync(p) || stable(fs.readFileSync(p, 'utf8')) !== stable(f.content)) write(f.path, f.content);
  }
  write('data/index.json', JSON.stringify(buildIndex(weeks.map(indexEntry), calendars), null, 1) + '\n');
}
console.log(`${changed} weeks changed`);
