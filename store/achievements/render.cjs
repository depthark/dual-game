const { chromium } = require('playwright');
const out = process.argv[2];
const C = '#00E8FF', M = '#FF0099', G = '#39FF88', Y = '#FFD23F', Wt = '#FFFFFF';
const glow = (id, c) => `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14" result="b"/><feFlood flood-color="${c}" flood-opacity="0.9"/><feComposite in2="b" operator="in" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
const frame = (accent, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
<defs>${glow('gc', C)}${glow('gm', M)}${glow('ga', accent)}${glow('gw', Wt)}${glow('gg', G)}${glow('gy', Y)}
<radialGradient id="bg" cx="50%" cy="38%" r="70%"><stop offset="0" stop-color="#16162A"/><stop offset="0.55" stop-color="#08080F"/><stop offset="1" stop-color="#05050A"/></radialGradient></defs>
<rect width="1024" height="1024" fill="url(#bg)"/>
<circle cx="512" cy="512" r="430" fill="none" stroke="${accent}" stroke-opacity="0.35" stroke-width="6" filter="url(#ga)"/>
${body}</svg>`;
const dots = (y = 800) => `<circle cx="432" cy="${y}" r="26" fill="${C}" filter="url(#gc)"/><circle cx="592" cy="${y}" r="26" fill="${M}" filter="url(#gm)"/>`;
const num = (t, c, size = 360, y = 600, f = 'ga') => `<text x="512" y="${y}" text-anchor="middle" font-family="Courier New, monospace" font-weight="900" font-size="${size}" fill="${c}" filter="url(#${f})" letter-spacing="-10">${t}</text>`;
const lv = (n, accent) => frame(accent, `<text x="512" y="300" text-anchor="middle" font-family="Courier New, monospace" font-weight="900" font-size="96" fill="#fff" fill-opacity="0.85" letter-spacing="24">LV</text>${num(n, accent, n.length > 1 ? 340 : 400, 650)}${dots(800)}`);
const icons = {
  warmup: frame(C, `<text x="512" y="330" text-anchor="middle" font-family="Courier New, monospace" font-weight="900" font-size="80" fill="#fff" fill-opacity="0.85" letter-spacing="18">WARM-UP</text>${num('500', C, 300, 610, 'gc')}${dots(790)}`),
  level3: lv('3', C),
  level5: lv('5', '#7C8CFF'),
  level7: lv('7', M),
  level10: lv('10', Y),
  beyond: frame(Y, `<path d="M512 170 L590 420 L850 420 L640 575 L720 830 L512 675 L304 830 L384 575 L174 420 L434 420 Z" fill="none" stroke="${Y}" stroke-width="22" stroke-linejoin="round" filter="url(#gy)"/>${num('10K', '#fff', 170, 590, 'gy')}`),
  ghosthunter: frame(Wt, `<circle cx="512" cy="470" r="200" fill="none" stroke="#fff" stroke-width="22" filter="url(#gw)"/><circle cx="512" cy="470" r="110" fill="none" stroke="#fff" stroke-width="22" filter="url(#gw)"/><circle cx="512" cy="470" r="34" fill="#fff" filter="url(#gw)"/>${[0,1,2,3,4].map(i => `<circle cx="${352 + i * 80}" cy="790" r="22" fill="#fff" filter="url(#gw)"/>`).join('')}`),
  slowmotion: frame(G, `<circle cx="600" cy="500" r="120" fill="${G}" filter="url(#gg)"/>${[0,1,2].map(i => `<line x1="${200 + i * 30}" y1="${400 + i * 100}" x2="${430 - i * 10}" y2="${400 + i * 100}" stroke="${G}" stroke-opacity="${0.9 - i * 0.2}" stroke-width="22" stroke-linecap="round" filter="url(#gg)"/>`).join('')}${[0,1,2].map(i => `<circle cx="${432 + i * 80}" cy="790" r="22" fill="${G}" filter="url(#gg)"/>`).join('')}`),
  razorsedge: frame(M, `<rect x="140" y="440" width="300" height="56" rx="10" fill="${C}" filter="url(#gc)"/><rect x="584" y="440" width="300" height="56" rx="10" fill="${C}" filter="url(#gc)"/><circle cx="560" cy="468" r="36" fill="${M}" filter="url(#gm)"/><path d="M450 330 L480 400 M512 300 L512 395 M575 330 L545 400" stroke="#fff" stroke-width="14" stroke-linecap="round" filter="url(#gw)"/><text x="512" y="760" text-anchor="middle" font-family="Courier New, monospace" font-weight="900" font-size="150" fill="#fff" filter="url(#gm)">×10</text>`),
  ambidextrous: frame(C, `<circle cx="340" cy="512" r="150" fill="none" stroke="${C}" stroke-width="20" filter="url(#gc)"/><circle cx="300" cy="512" r="62" fill="${C}" filter="url(#gc)"/><circle cx="684" cy="512" r="150" fill="none" stroke="${M}" stroke-width="20" filter="url(#gm)"/><circle cx="724" cy="512" r="62" fill="${M}" filter="url(#gm)"/><text x="512" y="800" text-anchor="middle" font-family="Courier New, monospace" font-weight="900" font-size="90" fill="#fff" letter-spacing="16" filter="url(#gw)">2 HANDS</text>`),
};
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
  for (const [k, svg] of Object.entries(icons)) {
    await page.setContent(`<html><body style="margin:0;background:#05050A">${svg}</body></html>`);
    await page.locator('svg').screenshot({ path: `${out}/${k}.png`, omitBackground: false });
  }
  await browser.close();
})();
