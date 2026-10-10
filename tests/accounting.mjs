import assert from 'node:assert/strict';
import { buildEvent, calculateSalary, eventAccounting, monthlyTotals } from '../js/core.js';

const person = 'Безносиков';
const event = (day, title = 'Спектакль «Обычный»', timeText = '12:00', name = person) => buildEvent({
  id: `${day}-${title}-${timeText}`, date: `2026-10-${String(day).padStart(2, '0')}`,
  title, timeText, lines: [name], place: 'Старая сцена',
});
const week = (events) => ({ id: 'test', start: '2026-10-01', end: '2026-10-31', events });
const total = (events, name = person) => monthlyTotals([week(events)], name, '2026-10');
const pay = (events, name = person, salary = 100000) => calculateSalary(total(events, name), salary);
const line = (calc, key) => calc.lines.find((l) => l.key === key);
const ordinary = (n) => Array.from({ length: n }, (_, i) => event(i + 1));

const withinNorm = [...ordinary(7), event(8, 'Спектакль «Собачка»')];
assert.equal(total(withinNorm).confirmed.shows, 8);
assert.equal(total(withinNorm).confirmed.babyShows, 1);
assert.equal(pay(withinNorm).bonusPercent, 0);
assert.equal(pay(withinNorm).net, 87000);

const ninthBaby = [...ordinary(8), event(9, 'Спектакль «Первый снег малыша»')];
const ninthPay = pay(ninthBaby);
assert.equal(total(ninthBaby).confirmed.aboveNorm, 1);
assert.equal(line(ninthPay, 'show').count, 0);
assert.equal(line(ninthPay, 'baby').count, 1);
assert.equal(ninthPay.bonusPercent, 3);
assert.equal(ninthPay.gross, 103000);
assert.equal(ninthPay.net, 89610);
assert.equal(pay([...ninthBaby, event(10, 'Спектакль «Собачка»')]).bonusPercent, 6);

const earlyBaby = [event(1, 'Спектакль «Собачка»'), ...ordinary(8).map((e, i) => ({ ...e, date: `2026-10-${String(i + 2).padStart(2, '0')}` }))];
assert.equal(pay(earlyBaby.reverse()).bonusPercent, 5);
assert.equal(line(pay(earlyBaby), 'baby').count, 0);
console.log('PASS: first eight include babies without payment; ninth baby gives only 3%; chronological order matters');

const teremok = event(10, 'Спектакль «Теремок»', '11:00 13:00 15:00', 'Баранов, Носов, Безносиков');
assert.equal(total([teremok], 'Баранов').confirmed.shows, 1.5);
assert.equal(total([teremok], 'Носов').confirmed.shows, 1.5);
assert.equal(total([teremok], person).confirmed.shows, 3);
assert.equal(total([teremok], 'Баранов').confirmed.halfShows, 3);
const seventeenHalves = Array.from({ length: 17 }, (_, i) => event(i + 1, 'Спектакль «Теремок»', '12:00', 'Баранов'));
assert.equal(total(seventeenHalves, 'Баранов').confirmed.shows, 8.5);
assert.equal(pay(seventeenHalves, 'Баранов').bonusPercent, 2.5);
assert.equal(pay(seventeenHalves, 'Баранов').net, 89175);
const crossing = [...ordinary(7).map((e) => ({ ...e, people: [{ ...e.people[0], name: 'Баранов' }] })), event(8, 'Спектакль «Теремок»', '12:00', 'Баранов'), event(9, 'Спектакль «Обычный»', '12:00', 'Баранов')];
assert.equal(pay(crossing, 'Баранов').bonusPercent, 2.5);
crossing[8] = event(9, 'Спектакль «Собачка»', '12:00', 'Баранов');
assert.equal(pay(crossing, 'Баранов').bonusPercent, 1.5);
console.log('PASS: surname-specific Teremok weights and proportional payment at the norm boundary');

const away = event(20, 'ВЫЕЗД спектакля «Кот в сапогах»', 'в 10:00 и 12:00');
assert.equal(total([away]).confirmed.shows, 0);
assert.equal(total([away]).confirmed.awayShows, 2);
assert.equal(pay([away]).bonusPercent, 11);
assert.deepEqual(pay([away]).awayCharges.map((s) => s.percent), [6, 5]);
const threeAway = event(20, 'ВЫЕЗД спектакля «Кот в сапогах»', '10:00 12:00 14:00');
assert.equal(pay([threeAway]).bonusPercent, 16);
assert.equal(pay([threeAway, event(21, 'Гастроли спектакля «Кот в сапогах»')]).bonusPercent, 22);
assert.equal(pay([event(20, 'ВЫЕЗД спектакля «Другой»', '14:00'), away]).bonusPercent, 16);
const restricted = { ...away, people: [{ ...away.people[0], times: ['12:00'] }] };
assert.equal(pay([restricted]).bonusPercent, 6);
const festival = event(22, 'Фестиваль «Кот в сапогах»');
assert.equal(eventAccounting(festival).away, true);
assert.equal(pay([festival]).bonusPercent, 6);
assert.equal(eventAccounting(event(22, 'Отъезд на фестиваль спектакля «Кот в сапогах»')).showWeight, 0);
assert.equal(eventAccounting(event(22, 'Репетиция спектакля «Кот в сапогах» на фестивале')).showWeight, 0);
console.log('PASS: two away times pay 11%, three pay 16%, rates restart each day, and participant time restrictions apply');

const intro = (day, role, title = 'Ввод в спектакль «Конёк-горбунок»') => {
  const e = event(day, title);
  e.people[0].role = role;
  return e;
};
const introductions = [intro(4, 'вводящий'), intro(4, 'вводящий', 'Ввод в спектакль «Другой»'), intro(13, 'вводящий'), intro(14, 'вводящийся'), intro(15, null)];
assert.deepEqual(total(introductions).confirmed.introDays, { mentor: 2, newcomer: 1, actor: 1 });
assert.equal(pay(introductions).bonusPercent, 16);
const combined = pay([...ninthBaby, threeAway, ...introductions]);
assert.equal(combined.bonusPercent, 35);
assert.equal(combined.gross, 135000);
assert.equal(combined.tax, 17550);
assert.equal(combined.net, 117450);
console.log('PASS: unique intro days and rates 6/3/4%; tax applies to base plus every bonus');

const uncertain = event(9);
uncertain.people[0].uncertain = true;
const alternate = event(10);
alternate.people[0].alts = ['Радыгин'];
assert.equal(pay([...ordinary(8), uncertain, alternate]).bonusPercent, 0);
assert.equal(total([...ordinary(8), uncertain, alternate]).possible.shows, 2);
const changedWeek = { ...week(ordinary(8)), previous: week([event(9), away]) };
assert.equal(calculateSalary(monthlyTotals([changedWeek], person, '2026-10'), 100000).bonusPercent, 0);
const oldBaby = event(9, 'Спектакль «Собачка»');
oldBaby.accounting = { showWeight: 0.5, away: false, intro: false };
assert.equal(pay([...ordinary(8), oldBaby]).bonusPercent, 3);
assert.equal(eventAccounting(event(1, 'Репетиция спектакля «Собачка»')).baby, false);
assert.deepEqual(teremok.accounting.halfFor, ['баранов', 'носов']);
assert.equal(event(1, 'Спектакль «Первый снег малыша»').accounting.baby, true);
console.log('PASS: canceled and uncertain events excluded; old JSON recalculated; new PDF/admin events carry built-in flags');

for (const input of ['', '-1', 'NaN', 'Infinity', '1e5', '0', '123,456']) assert.throws(() => pay([], person, input));
const kopecks = pay([], person, '50 000,50');
assert.equal(kopecks.base, 50000.5);
assert.equal(kopecks.tax, 6500.07);
assert.equal(kopecks.net, 43500.43);
console.log('PASS: money input validation, comma/space input, and kopeck rounding');
