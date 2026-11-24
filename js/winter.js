import { makeBank, snowHeight, depositSnow } from './winter-physics.js';

// Не импортируется расписанием: отказ декораций не влияет на основное приложение.
const scene = document.querySelector('#winterScene');
const canvas = document.querySelector('#winterCanvas');
const ctx = canvas?.getContext('2d');
if (scene && ctx) startWinter();

function startWinter() {
  const root = document.documentElement;
  const lights = document.querySelector('#winterLights');
  const modeButton = document.querySelector('#winterMode');
  const modeName = document.querySelector('#winterModeName');
  const wire = document.querySelector('.winter-wire');
  const toggle = document.querySelector('#winterToggle');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const dark = matchMedia('(prefers-color-scheme: dark)');
  const modes = [['wave', 'Волна'], ['chase', 'Бегущие огни'], ['twinkle', 'Мерцание']];
  let enabled = true;
  try { enabled = localStorage.getItem('rs.winter.enabled') !== 'false'; } catch { /* private mode */ }
  let width = 0, height = 0, ground, flakes = [], ledges = [];
  const ledgeBanks = new WeakMap();
  let scanNeeded = true, frame = 0, lastFrame = 0, elapsed = 0, nextMode = 18;
  let mode = 0, suspended = false;

  function setMode(value) {
    mode = value % modes.length;
    lights.dataset.mode = modes[mode][0];
    modeName.textContent = modes[mode][1];
    modeButton.setAttribute('aria-label', `Гирлянда: ${modes[mode][1]}. Переключить режим`);
  }
  modeButton.addEventListener('click', () => {
    if (!enabled) setEnabled(true);
    setMode(mode + 1); nextMode = elapsed + 25;
  });
  toggle.addEventListener('click', () => setEnabled(!enabled));
  function setEnabled(value) {
    enabled = value;
    try { localStorage.setItem('rs.winter.enabled', String(value)); } catch { /* private mode */ }
    syncActivity();
  }

  function spawn(startAnywhere = false) {
    const centerWidth = Math.min(width, 560);
    return { x: Math.random() < .7 ? (width - centerWidth) / 2 + Math.random() * centerWidth : Math.random() * width,
      y: startAnywhere ? Math.random() * height : -12, r: 1.1 + Math.random() * 2.2,
      speed: 24 + Math.random() * 51, sway: 8 + Math.random() * 22, phase: Math.random() * Math.PI * 2,
      frequency: .5 + Math.random(), alpha: .35 + Math.random() * .55, star: Math.random() > .72 };
  }
  function resize() {
    width = window.innerWidth; height = window.innerHeight;
    // Постоянный шаг лампочек и продолжение за обоими краями экрана.
    const bulbCount = Math.ceil(width / 42) + 2;
    if (wire.children.length !== bulbCount) {
      wire.replaceChildren(...Array.from({ length: bulbCount }, (_, i) => {
        const bulb = document.createElement('i');
        const t = ((i * 42 + 5.5) % 336) / 336;
        const drop = 8 + 54 * t * (1 - t);
        bulb.setAttribute('style', `--i:${i};--drop:${drop.toFixed(2)}px`);
        return bulb;
      }));
    }
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const old = ground;
    ground = makeBank(width, 42, 7);
    if (old) ground.heights = ground.heights.map((v, i) => snowHeight(old, i / (ground.heights.length - 1) * old.width));
    flakes = Array.from({ length: width < 600 ? 52 : 78 }, () => spawn(true));
    scanNeeded = true;
    if (!frame) draw();
  }
  function scanLedges() {
    ledges = [...document.querySelectorAll('#feed .card, #feed .cal, #feed .totals-panel')]
      .map((element) => {
        const r = element.getBoundingClientRect();
        if (r.top < 70 || r.top > height - 95 || r.width < 100) return null;
        const w = Math.min(r.width * .4, 150);
        let cap = ledgeBanks.get(element);
        if (!cap) {
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          svg.setAttribute('class', 'winter-snow-cap');
          svg.setAttribute('aria-hidden', 'true');
          svg.setAttribute('focusable', 'false');
          svg.appendChild(path);
          element.classList.add('winter-snow-anchor');
          element.appendChild(svg);
          cap = { bank: makeBank(w, 7), svg, path };
          ledgeBanks.set(element, cap);
          updateCap(cap);
        } else if (Math.abs(cap.bank.width - w) > 1) {
          const old = cap.bank;
          cap.bank = makeBank(w, 7);
          cap.bank.heights = cap.bank.heights.map((v, i) => snowHeight(old, i / (cap.bank.heights.length - 1) * old.width));
          updateCap(cap);
        }
        // Координаты экрана нужны только для столкновений падающих снежинок.
        // Сам сугроб находится внутри карточки и прокручивается браузером вместе с ней.
        const capRect = cap.svg.getBoundingClientRect();
        return { x: capRect.left, y: capRect.top + 9, bank: cap.bank, cap };
      }).filter(Boolean).slice(0, 6).sort((a, b) => a.y - b.y);
    scanNeeded = false;
  }
  function updateCap({ bank, svg, path }) {
    svg.setAttribute('viewBox', `0 0 ${bank.width} 10`);
    svg.style.width = `${bank.width}px`;
    const points = bank.heights.map((h, i) => `${i ? 'L' : 'M'}${i * bank.width / (bank.heights.length - 1)} ${9 - h}`);
    path.setAttribute('d', `${points.join(' ')} L${bank.width} 10 L0 10 Z`);
  }
  function drawBank(bank, x, baseline, bottom) {
    const step = bank.width / (bank.heights.length - 1);
    ctx.beginPath(); ctx.moveTo(x, baseline - bank.heights[0]);
    for (let i = 1; i < bank.heights.length; i++) {
      ctx.lineTo(x + i * step, baseline - bank.heights[i]);
    }
    ctx.lineTo(x + bank.width, bottom); ctx.lineTo(x, bottom); ctx.closePath();
    ctx.fillStyle = dark.matches ? '#e0edf5' : '#e3eff7'; ctx.fill();
    ctx.strokeStyle = dark.matches ? '#ffffffb0' : '#b9d1e2'; ctx.lineWidth = .7; ctx.stroke();
  }
  function drawFlake(f) {
    ctx.globalAlpha = f.alpha;
    ctx.fillStyle = dark.matches ? '#f5faff' : '#7299b7';
    if (f.star) {
      ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let a = 0; a < 3; a++) { const angle = a * Math.PI / 3 + f.phase; const dx = Math.cos(angle) * f.r * 1.7, dy = Math.sin(angle) * f.r * 1.7; ctx.moveTo(f.x - dx, f.y - dy); ctx.lineTo(f.x + dx, f.y + dy); }
      ctx.stroke();
    } else { ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill(); }
  }
  function draw() {
    if (!ground) return;
    if (scanNeeded) scanLedges();
    ctx.clearRect(0, 0, width, height);
    if (!reduced.matches) flakes.forEach(drawFlake);
    ctx.globalAlpha = 1;
    drawBank(ground, 0, height, height);
  }
  function tick(now) {
    frame = 0;
    if (suspended || !enabled || reduced.matches) return;
    if (now - lastFrame < 32) { frame = requestAnimationFrame(tick); return; }
    const delta = (now - lastFrame) / 1000;
    const dt = Math.min(delta, .06); lastFrame = now; elapsed += delta;
    if (scanNeeded) scanLedges();
    flakes.forEach((f, i) => {
      const before = f.y;
      f.x += (Math.sin(elapsed * f.frequency + f.phase) * f.sway + Math.sin(elapsed * .25) * 12) * dt;
      f.y += f.speed * dt;
      if (f.x < -12) f.x = width + 10; if (f.x > width + 12) f.x = -10;
      const hit = ledges.find((l) => f.x >= l.x && f.x <= l.x + l.bank.width && before <= l.y - snowHeight(l.bank, f.x - l.x) && f.y >= l.y - snowHeight(l.bank, f.x - l.x));
      if (hit) { depositSnow(hit.bank, f.x - hit.x, .7 + f.r * .28); updateCap(hit.cap); flakes[i] = spawn(); }
      else if (f.y >= height - snowHeight(ground, f.x)) { depositSnow(ground, f.x, .8 + f.r * .65); flakes[i] = spawn(); }
    });
    if (elapsed > nextMode) { setMode(mode + 1); nextMode = elapsed + 18; }
    draw(); frame = requestAnimationFrame(tick);
  }
  function syncActivity() {
    const editing = document.activeElement?.matches('input, textarea, select, [contenteditable="true"]');
    suspended = document.hidden || !!editing || !!document.querySelector('dialog[open]');
    scene.hidden = !enabled || suspended;
    root.classList.toggle('winter-active', enabled);
    root.classList.toggle('winter-off', !enabled);
    root.classList.toggle('winter-paused', suspended);
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.setAttribute('title', enabled ? 'Выключить новогодние эффекты' : 'Включить новогодние эффекты');
    if (frame) cancelAnimationFrame(frame); frame = 0;
    if (enabled && !suspended) {
      if (reduced.matches) draw();
      else { lastFrame = performance.now(); frame = requestAnimationFrame(tick); }
    }
  }
  const view = document.querySelector('#view');
  new MutationObserver((records) => {
    // Вставка сугробов не должна запускать ещё один обход интерфейса.
    if (records.every((r) => [...r.addedNodes, ...r.removedNodes].every((n) => n.nodeType === 1 && n.classList.contains('winter-snow-cap')))) return;
    scanNeeded = true; syncActivity();
  }).observe(view, { childList: true, subtree: true });
  view.addEventListener('click', () => { scanNeeded = true; });
  const dialogs = new MutationObserver(syncActivity);
  document.querySelectorAll('dialog').forEach((d) => dialogs.observe(d, { attributes: true, attributeFilter: ['open'] }));
  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('scroll', () => { scanNeeded = true; if (reduced.matches) draw(); }, { passive: true });
  document.addEventListener('visibilitychange', syncActivity);
  document.addEventListener('focusin', syncActivity);
  document.addEventListener('focusout', () => queueMicrotask(syncActivity));
  window.addEventListener('pagehide', () => { if (frame) cancelAnimationFrame(frame); frame = 0; });
  window.addEventListener('pageshow', syncActivity);
  reduced.addEventListener('change', syncActivity);
  dark.addEventListener('change', draw);
  setMode(0); resize(); syncActivity();
}
