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
  const toggle = document.querySelector('#winterToggle');
  const visitor = document.querySelector('#winterVisitor');
  const character = document.querySelector('#winterCharacter');
  const portrait = document.querySelector('#winterPortrait');
  const fallback = document.querySelector('#winterFallback');
  const bubble = document.querySelector('#winterBubble');
  const hint = document.querySelector('.winter-catch-hint');
  const invite = document.querySelector('#winterInvite');
  const announcement = document.querySelector('#winterAnnouncement');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const dark = matchMedia('(prefers-color-scheme: dark)');
  const modes = [['wave', 'Волна'], ['chase', 'Бегущие огни'], ['twinkle', 'Мерцание']];
  const characters = [
    { name: 'Деда Мороза', image: 'ded-moroz', welcome: 'Новогодка близко', replies: ['Поймал! Новогодка близко 🎄', 'Хо-хо! Всем аншлагов и мандаринов!', 'Твой подарок — ещё одна репетиция. Шучу!', 'Пусть все выходы будут удачными!'] },
    { name: 'снеговика', image: 'snowman', welcome: 'Тс-с… я тут на подмене!', replies: ['Поймал! Только не растопи меня ☃', 'Моя роль — стоять и не таять.', 'Снег идёт. А я уже пришёл!', 'Морковка на месте. К выходу готов!'] },
  ];
  let enabled = true;
  try { enabled = localStorage.getItem('rs.winter.enabled') !== 'false'; } catch { /* private mode */ }
  let width = 0, height = 0, ground, flakes = [], bursts = [], ledges = [];
  const ledgeBanks = new WeakMap();
  let scanNeeded = true, frame = 0, lastFrame = 0, elapsed = 0, nextMode = 18;
  let nextVisitor = 2.5, exitAt = 0, guest = -1, catches = [0, 0], visible = false;
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
        let bank = ledgeBanks.get(element);
        if (!bank || Math.abs(bank.width - w) > 1) { bank = makeBank(w, 7); ledgeBanks.set(element, bank); }
        return { x: r.right - w - 16, y: r.top + 1, bank };
      }).filter(Boolean).slice(0, 6).sort((a, b) => a.y - b.y);
    scanNeeded = false;
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
    bursts.forEach(drawFlake); ctx.globalAlpha = 1;
    ledges.forEach((ledge) => drawBank(ledge.bank, ledge.x, ledge.y, ledge.y + 1));
    drawBank(ground, 0, height, height);
  }
  function snowBurst(x, y) {
    if (reduced.matches) return;
    // Ограничиваем и частицы после серии быстрых нажатий.
    bursts = bursts.slice(-45);
    for (let i = 0; i < 24; i++) bursts.push({ x, y, r: 1 + Math.random() * 2, alpha: 1, star: i % 3 === 0,
      phase: Math.random(), vx: (Math.random() - .5) * 140, vy: -35 - Math.random() * 110, life: 1.6 });
  }
  function showVisitor() {
    if (!enabled || suspended || visible) return;
    guest = (guest + 1) % characters.length;
    const data = characters[guest];
    portrait.hidden = false; fallback.hidden = true;
    fallback.textContent = guest === 0 ? '🎅' : '☃';
    portrait.src = `assets/winter/${data.image}.webp`;
    character.setAttribute('aria-label', `Поймать ${data.name}`);
    visitor.dataset.character = guest === 0 ? 'santa' : 'snowman';
    visitor.classList.remove('is-caught'); bubble.textContent = data.welcome;
    hint.textContent = 'Поймай меня!'; visitor.hidden = false; invite.hidden = true;
    // Следующий кадр нужен для появления из-за края экрана.
    visitor.getBoundingClientRect(); visitor.classList.add('is-visible');
    character.disabled = false; visible = true; exitAt = elapsed + 10;
  }
  function hideVisitor() {
    invite.hidden = false;
    if (visitor.contains(document.activeElement)) invite.focus({ preventScroll: true });
    visitor.classList.remove('is-visible'); character.disabled = true;
    visible = false; invite.hidden = false; nextVisitor = elapsed + 22 + Math.random() * 10;
  }
  character.addEventListener('click', () => {
    const data = characters[guest];
    const text = data.replies[catches[guest]++ % data.replies.length];
    bubble.textContent = text; announcement.textContent = text; hint.textContent = 'Ещё раз?';
    visitor.classList.remove('is-caught'); visitor.getBoundingClientRect(); visitor.classList.add('is-caught');
    const r = character.getBoundingClientRect(); snowBurst(r.x + r.width / 2, r.y + 45);
    exitAt = elapsed + 7;
  });
  invite.addEventListener('click', showVisitor);
  // При недоступной картинке остаются читаемые кнопки вместо сломанного изображения.
  portrait.addEventListener('error', () => { portrait.hidden = true; fallback.hidden = false; });

  function tick(now) {
    frame = 0;
    if (suspended || !enabled || reduced.matches) return;
    if (now - lastFrame < 32) { frame = requestAnimationFrame(tick); return; }
    const dt = Math.min((now - lastFrame) / 1000, .06); lastFrame = now; elapsed += dt;
    if (scanNeeded) scanLedges();
    flakes.forEach((f, i) => {
      const before = f.y;
      f.x += (Math.sin(elapsed * f.frequency + f.phase) * f.sway + Math.sin(elapsed * .25) * 12) * dt;
      f.y += f.speed * dt;
      if (f.x < -12) f.x = width + 10; if (f.x > width + 12) f.x = -10;
      const hit = ledges.find((l) => f.x >= l.x && f.x <= l.x + l.bank.width && before <= l.y - snowHeight(l.bank, f.x - l.x) && f.y >= l.y - snowHeight(l.bank, f.x - l.x));
      if (hit) { depositSnow(hit.bank, f.x - hit.x, .7 + f.r * .28); flakes[i] = spawn(); }
      else if (f.y >= height - snowHeight(ground, f.x)) { depositSnow(ground, f.x, .8 + f.r * .65); flakes[i] = spawn(); }
    });
    bursts = bursts.filter((p) => p.life > 0);
    bursts.forEach((p) => { p.x += p.vx * dt; p.vy += 100 * dt; p.y += p.vy * dt; p.life -= dt; p.alpha = Math.max(0, p.life / 1.6); });
    if (elapsed > nextMode) { setMode(mode + 1); nextMode = elapsed + 18; }
    if (!visible && elapsed > nextVisitor) showVisitor();
    if (visible && elapsed > exitAt && !character.matches(':focus-visible')) hideVisitor();
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
  new MutationObserver(() => { scanNeeded = true; }).observe(document.querySelector('#view'), { childList: true, subtree: true });
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
