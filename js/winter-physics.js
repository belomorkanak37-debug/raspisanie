// Ограниченная высота сугроба: снег никогда не закрывает содержимое экрана.
export function makeBank(width, maxHeight, initial = 0, step = 10) {
  const count = Math.max(3, Math.ceil(width / step) + 1);
  return { width, maxHeight, heights: Array.from({ length: count }, (_, i) =>
    initial * (.7 + .3 * Math.cos(i / (count - 1) * Math.PI * 4))) };
}

export function snowHeight(bank, x) {
  const p = Math.max(0, Math.min(bank.heights.length - 1, x / bank.width * (bank.heights.length - 1)));
  const i = Math.floor(p), next = Math.min(i + 1, bank.heights.length - 1);
  return bank.heights[i] * (1 - p + i) + bank.heights[next] * (p - i);
}

export function depositSnow(bank, x, amount = 1) {
  if (x < 0 || x > bank.width) return;
  const center = Math.round(x / bank.width * (bank.heights.length - 1));
  for (let i = Math.max(0, center - 3); i <= Math.min(bank.heights.length - 1, center + 3); i++) {
    const weight = Math.exp(-((i - center) ** 2) / 3);
    bank.heights[i] = Math.min(bank.maxHeight, bank.heights[i] + amount * weight);
  }
}
