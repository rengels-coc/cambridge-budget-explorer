/**
 * Brand compliance check for the Budget Explorer.
 *
 * Loads the running page in a real headless Edge/Chrome and audits it against
 * the rules in the City of Cambridge Brand Guidelines ("Cambridge Reimagined",
 * August 2024) that can actually be verified from the rendered DOM:
 *
 *   1. Contrast          WCAG 2.1 AA — 4.5:1 normal text, 3:1 large text.
 *   2. Sentence case     nothing rendered in forced all caps.
 *   3. Flat design       no gradients, no drop shadows.
 *   4. Palette           every colour used traces back to the brand palette.
 *   5. Typography        Noto Sans actually loaded, applied and painted.
 *   6. Licensing         no licensed font is bundled in the repository.
 *
 * It also writes full-page screenshots to docs/brand-review/ so the design can
 * be reviewed without running anything.
 *
 * Usage: node scripts/brand-check.mjs [baseUrl]
 */

import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] || 'http://localhost:8080/';
const PORT = 9334;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOT_DIR = join(ROOT, 'docs', 'brand-review');

const BROWSERS = [
  process.env.CHROME_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/opt/google/chrome/chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

/* Every colour the guidelines permit: the primary and secondary palettes, the
   approved black tints, plus white and black. Anything else is off-brand. */
const BRAND_COLORS = {
  '#00A9FF': 'Bright Blue', '#30B8FF': 'Sky Blue', '#70CBF7': 'Light Blue',
  '#CDECFF': 'Pastel Blue', '#196CC6': 'Mid Blue', '#1D2F8D': 'Dark Blue',
  '#009B13': 'Bright Green', '#29BA38': 'Green', '#70CB88': 'Light Green',
  '#C0EEA9': 'Pastel Green', '#016F31': 'Mid Green', '#003F2A': 'Dark Green',
  '#9129F3': 'Bright Purple', '#B45CFF': 'Purple', '#BB93FE': 'Light Purple',
  '#E5D1FF': 'Pastel Purple', '#730FE8': 'Mid Purple', '#5700BC': 'Dark Purple',
  '#F50000': 'Bright Red', '#F73030': 'Red', '#FF5667': 'Light Red',
  '#FFB2B6': 'Pastel Red', '#D20404': 'Mid Red', '#C20000': 'Dark Red',
  '#FF6000': 'Bright Orange', '#FF8017': 'Orange', '#FFA05B': 'Light Orange',
  '#FFCBA5': 'Pastel Orange', '#E55C00': 'Mid Orange', '#E94400': 'Dark Orange',
  '#FFC700': 'Bright Yellow', '#FFD232': 'Yellow', '#FFD863': 'Light Yellow',
  '#FFF4BE': 'Pastel Yellow', '#FFB800': 'Mid Yellow', '#FFA800': 'Dark Yellow',
  '#FF2F9C': 'Bright Magenta', '#FF60B3': 'Magenta', '#FF80D5': 'Light Magenta',
  '#FFC5EC': 'Pastel Magenta', '#EC1A88': 'Mid Magenta', '#CF0064': 'Dark Magenta',
  '#FFFFFF': 'White', '#000000': 'Black',
  '#E6E6E6': 'Black 10%', '#CCCCCC': 'Black 20%', '#999999': 'Black 40%',
  '#666666': 'Black 60%', '#333333': 'Black 80%',
};

let pass = 0;
const failures = [];
const notes = [];

function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(`${name}${detail ? ' — ' + detail : ''}`);
         console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`${method} timed out`)); }
      }, 45000);
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: `(function(){${expr}})()`, returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval threw');
    return r.result.value;
  }
}

/* ---------------------------------------------------------------------------
   The audit that runs inside the page. Kept as one self-contained string so it
   can be handed straight to Runtime.evaluate.
   --------------------------------------------------------------------------- */
const AUDIT = `
  function parseColor(c) {
    var m = /rgba?\\(([^)]+)\\)/.exec(c);
    if (!m) return null;
    var p = m[1].split(',').map(function (x) { return parseFloat(x); });
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function over(fg, bg) {
    var a = fg.a;
    return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a),
             b: fg.b * a + bg.b * (1 - a), a: 1 };
  }
  function lum(c) {
    var f = [c.r, c.g, c.b].map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
  }
  function ratio(a, b) {
    var l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }
  function hex(c) {
    function h(v) { return ('0' + Math.round(v).toString(16)).toUpperCase().slice(-2); }
    return '#' + h(c.r) + h(c.g) + h(c.b);
  }
  function effectiveBg(el) {
    var stack = [];
    var node = el;
    while (node && node.nodeType === 1) {
      var s = getComputedStyle(node);
      var c = parseColor(s.backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a === 1) break; }
      node = node.parentElement;
    }
    var out = { r: 255, g: 255, b: 255, a: 1 };
    for (var i = stack.length - 1; i >= 0; i--) out = over(stack[i], out);
    return out;
  }

  var contrast = [], caps = [], gradients = [], shadows = [], offBrand = {};
  var seenText = 0;
  var all = document.querySelectorAll('body *');

  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') continue;
    var box = el.getBoundingClientRect();
    if (!box.width || !box.height) continue;

    if (/gradient/.test(s.backgroundImage)) gradients.push(el.className || el.tagName);
    if (s.boxShadow && s.boxShadow !== 'none' && !/inset/.test(s.boxShadow)) {
      shadows.push((el.className || el.tagName) + ' :: ' + s.boxShadow);
    }
    if (s.textTransform === 'uppercase') caps.push(el.className || el.tagName);

    /* Collect declared colours for the palette sweep. */
    [s.color, s.backgroundColor, s.borderTopColor, s.borderBottomColor].forEach(function (v) {
      var c = parseColor(v);
      if (!c || c.a === 0) return;
      var h = hex(c);
      offBrand[h] = (offBrand[h] || 0) + 1;
    });

    /* Only measure elements that render their own text. */
    var own = '';
    for (var k = 0; k < el.childNodes.length; k++) {
      if (el.childNodes[k].nodeType === 3) own += el.childNodes[k].nodeValue;
    }
    if (!own.trim()) continue;
    seenText++;

    var fg = parseColor(s.color);
    if (!fg) continue;
    var bg = effectiveBg(el);
    var r = ratio(over(fg, bg), bg);
    var px = parseFloat(s.fontSize);
    var bold = parseInt(s.fontWeight, 10) >= 700;
    var large = px >= 24 || (px >= 18.66 && bold);
    var need = large ? 3 : 4.5;
    if (r < need - 0.005) {
      contrast.push({
        sel: (el.tagName + '.' + String(el.className || '')).slice(0, 70),
        text: own.trim().slice(0, 40),
        fg: hex(over(fg, bg)), bg: hex(bg),
        px: px, ratio: Math.round(r * 100) / 100, need: need
      });
    }
  }

  var fontsUsed = {};
  document.querySelectorAll('h1, h2, .kpi__value, .tab, .intro__lede, body, p, .btn-ghost')
    .forEach(function (el) {
      var f = getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g, '');
      fontsUsed[f] = (fontsUsed[f] || 0) + 1;
    });

  return {
    seenText: seenText,
    contrast: contrast,
    caps: Array.from(new Set(caps)),
    gradients: Array.from(new Set(gradients)),
    shadows: Array.from(new Set(shadows)),
    colors: Object.keys(offBrand).sort(),
    fonts: fontsUsed,
    notoLoaded: document.fonts.check('400 16px "Noto Sans"')
  };
`;

async function main() {
  const { existsSync } = await import('node:fs');
  const bin = BROWSERS.find((p) => existsSync(p));
  if (!bin) throw new Error('No Edge/Chrome binary found');
  const profile = await mkdtemp(join(tmpdir(), 'brand-cdp-'));

  const proc = spawn(bin, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check',
    '--window-size=1440,1000', '--force-device-scale-factor=1',
    'about:blank',
  ], { stdio: 'ignore' });

  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) {
    await sleep(500);
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = targets.find((t) => t.type === 'page');
      if (page) wsUrl = page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
  }
  if (!wsUrl) throw new Error('Could not connect to the browser');

  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', () => rej(new Error('websocket failed')));
  });

  const cdp = new CDP(ws);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
  });

  await mkdir(SHOT_DIR, { recursive: true });

  const shoot = async (name) => {
    const metrics = await cdp.send('Page.getLayoutMetrics');
    const h = Math.min(Math.ceil(metrics.cssContentSize.height), 6000);
    const r = await cdp.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: 1440, height: h, scale: 1 },
    });
    await writeFile(join(SHOT_DIR, name + '.png'), Buffer.from(r.data, 'base64'));
    console.log(`  shot  docs/brand-review/${name}.png (1440 x ${h})`);
  };

  const goto = async (hash) => {
    await cdp.send('Page.navigate', { url: BASE.replace(/#.*$/, '') + hash });
    await sleep(2600);
  };

  /* The computed font-family only tells you what was *asked* for. This asks the
     renderer what it actually painted with, which is the only honest way to
     verify type. */
  const renderedFont = async (selector) => {
    const { root } = await cdp.send('DOM.getDocument', { depth: 1 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (!nodeId) return [];
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    return fonts
      .slice()
      .sort((a, b) => b.glyphCount - a.glyphCount)
      .map((f) => `${f.familyName} (${f.glyphCount} glyphs)`);
  };

  console.log(`\nBrand check against ${BASE}\n`);

  /* ---- Overview ---- */
  await goto('#/overview');
  const ready = await cdp.eval(`return document.getElementById('kpi-total').textContent`);
  check('page loaded with data', ready && ready !== '—', `kpi-total = ${ready}`);

  const audit = await cdp.eval(AUDIT);

  check('Noto Sans is loaded and applied', audit.notoLoaded === true);

  /* Everything is Noto Sans now, so the interesting question is not which
     family painted the glyphs but whether the width axis actually engaged —
     that is what carries the display role. */
  const ledeFont = await renderedFont('.intro__lede');
  const bodyFont = await renderedFont('.intro__text p');
  check('the page headline is actually painted in Noto Sans',
    ledeFont.join(' ').includes('Noto Sans'),
    'painted with: ' + (ledeFont.join(', ') || 'nothing'));
  check('body copy is actually painted in Noto Sans',
    bodyFont.join(' ').includes('Noto Sans'),
    'painted with: ' + (bodyFont.join(', ') || 'nothing'));

  const widths = await cdp.eval(`
    const m = (stretch) => {
      const s = document.createElement('span');
      s.textContent = 'Where Cambridge\\u2019s money goes.';
      s.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;' +
        'font:700 34px "Noto Sans";font-stretch:' + stretch;
      document.body.appendChild(s);
      const w = s.getBoundingClientRect().width;
      s.remove();
      return w;
    };
    return { normal: m('100%'), display: m('80%') };
  `);
  check('the display width axis is really engaging (not faked)',
    widths.display < widths.normal * 0.95,
    `80% width = ${widths.display.toFixed(1)}px vs 100% = ${widths.normal.toFixed(1)}px`);
  notes.push(`Headline painted with ${ledeFont.join(', ')}; body copy with ${bodyFont.join(', ')}. ` +
    `Display width axis condenses ${widths.normal.toFixed(0)}px to ${widths.display.toFixed(0)}px.`);

  /* A real release gate: this repository is public, so no licensed font may be
     sitting in it. Anything that is not an OFL Noto Sans subset fails. */
  const { readdir } = await import('node:fs/promises');
  const fontDir = join(ROOT, 'assets', 'fonts');
  const fontFiles = (await readdir(fontDir, { recursive: true, withFileTypes: true }))
    .filter((e) => e.isFile() && /\.(woff2?|otf|ttf|eot)$/i.test(e.name))
    .map((e) => e.name);
  const unlicensed = fontFiles.filter((f) => !/^noto-sans-/i.test(f));
  check('no licensed font is bundled in the repository',
    unlicensed.length === 0,
    'found: ' + unlicensed.join(', '));
  notes.push(`Fonts shipped: ${fontFiles.join(', ')} — all SIL OFL.`);

  check('no gradients anywhere', audit.gradients.length === 0, audit.gradients.join(' | '));
  check('no drop shadows anywhere', audit.shadows.length === 0, audit.shadows.join(' | '));
  check('nothing is forced to all caps', audit.caps.length === 0, audit.caps.join(' | '));

  const stray = audit.colors.filter((h) => !BRAND_COLORS[h]);
  check('every colour is from the brand palette', stray.length === 0, stray.join(' '));

  check(`all ${audit.seenText} text elements meet WCAG AA`,
    audit.contrast.length === 0,
    audit.contrast.map((c) => `${c.sel} "${c.text}" ${c.fg} on ${c.bg} = ${c.ratio}:1 (needs ${c.need})`).join('\n        '));

  notes.push(`Colours in use: ${audit.colors.map((h) => `${h} ${BRAND_COLORS[h] || '(OFF BRAND)'}`).join(', ')}`);

  await shoot('01-overview');

  /* ---- The other views, for the screenshot record and a second contrast pass ---- */
  for (const [hash, name] of [['#/trends', '02-trends'], ['#/detail', '03-detail'],
                              ['#/compare', '04-compare'], ['#/capital', '05-capital']]) {
    await goto(hash);
    const a2 = await cdp.eval(AUDIT);
    check(`${name}: contrast, flat design and sentence case hold`,
      a2.contrast.length === 0 && a2.gradients.length === 0 &&
      a2.shadows.length === 0 && a2.caps.length === 0,
      [...a2.contrast.map((c) => `${c.sel} "${c.text}" ${c.fg} on ${c.bg} = ${c.ratio}:1`),
       ...a2.gradients, ...a2.shadows, ...a2.caps].join('\n        '));
    const s2 = a2.colors.filter((h) => !BRAND_COLORS[h]);
    check(`${name}: palette is on brand`, s2.length === 0, s2.join(' '));
    await shoot(name);
  }

  /* ---- Mobile ---- */
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
  });
  await goto('#/overview');
  const m = await cdp.eval(AUDIT);
  check('mobile: contrast and flat design hold',
    m.contrast.length === 0 && m.gradients.length === 0 && m.caps.length === 0,
    [...m.contrast.map((c) => `${c.sel} "${c.text}" = ${c.ratio}:1`), ...m.gradients, ...m.caps].join('\n        '));
  {
    const metrics = await cdp.send('Page.getLayoutMetrics');
    const h = Math.min(Math.ceil(metrics.cssContentSize.height), 6000);
    const r = await cdp.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: 390, height: h, scale: 1 },
    });
    await writeFile(join(SHOT_DIR, '06-mobile.png'), Buffer.from(r.data, 'base64'));
    console.log(`  shot  docs/brand-review/06-mobile.png (390 x ${h})`);
  }

  ws.close();
  proc.kill();
  await rm(profile, { recursive: true, force: true }).catch(() => {});

  console.log(`\n${notes.join('\n')}\n`);
  console.log(`${pass} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
