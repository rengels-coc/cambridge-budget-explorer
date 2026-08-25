/**
 * Interaction test for the Budget Explorer.
 * Drives a real headless Edge/Chrome over the DevTools Protocol and asserts on
 * what the page actually does when you click and type. Node 22 has a built-in
 * WebSocket, so this needs no dependencies.
 *
 * Usage: node scripts/interaction-test.mjs [baseUrl]
 */

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://localhost:8080/';
const PORT = 9333;

const EDGE_CANDIDATES = [
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

let pass = 0;
const failures = [];

function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(`${name}${detail ? ' — ' + detail : ''}`);
    console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findBrowser() {
  const { existsSync } = await import('node:fs');
  const found = EDGE_CANDIDATES.find((p) => existsSync(p));
  if (!found) throw new Error('No Edge/Chrome binary found');
  return found;
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
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
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`${method} timed out`));
        }
      }, 30000);
    });
  }

  /** Evaluate an expression in the page and return its JSON value. */
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: `(function(){${expr}})()`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || 'eval threw');
    }
    return r.result.value;
  }
}

async function main() {
  const bin = await findBrowser();
  const profile = await mkdtemp(join(tmpdir(), 'poc-cdp-'));

  const proc = spawn(bin, [
    '--headless=new',
    '--disable-gpu',
    // Needed when this runs inside a CI container; harmless on a desktop.
    '--no-sandbox',
    '--disable-dev-shm-usage',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });

  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) {
    await sleep(500);
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page');
      if (page) wsUrl = page.webSocketDebuggerUrl;
    } catch { /* browser not up yet */ }
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

  /* Panels are hidden until their tab is selected, so any check against a
     section other than the overview has to activate that tab first. Clicking
     the real tab link is deliberate — it exercises the router, not a shortcut
     around it. */
  const goTab = async (id) => {
    await cdp.eval(`document.getElementById('tab-${id}').click(); return 1`);
    await sleep(250);
  };

  const consoleErrors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(
        m.params.exceptionDetails?.exception?.description ||
        m.params.exceptionDetails?.text || 'unknown error'
      );
    }
  });

  console.log(`\nLoading ${BASE}`);
  await cdp.send('Page.navigate', { url: BASE });

  // Wait for the app to finish its initial render.
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    await sleep(500);
    ready = await cdp.eval(`
      var s = document.getElementById('status');
      return !!(s && s.hidden) && document.querySelectorAll('.tree-row').length > 0;
    `).catch(() => false);
  }
  if (!ready) throw new Error('Page never finished loading');

  console.log('\nInitial render');
  check('no uncaught page exceptions', consoleErrors.length === 0, consoleErrors[0]);
  check('KPI shows FY2027 total',
    (await cdp.eval(`return document.getElementById('kpi-total').textContent`)) === '$1.03B');
  check('service bars rendered',
    (await cdp.eval(`return document.querySelectorAll('#service-chart .bar-row').length`)) === 6);
  check('stacked chart has 17 years of segments',
    (await cdp.eval(`return document.querySelectorAll('#composition-chart .stack-seg').length`)) > 90);
  check('tree starts collapsed at service level',
    (await cdp.eval(`return document.querySelectorAll('#detail-tree .tree-row').length`)) === 6);

  /* ---- tabs ---- */
  console.log('\nTabs');
  check('nine tabs rendered',
    (await cdp.eval(`return document.querySelectorAll('.tabbar [role="tab"]').length`)) === 9);
  check('overview is the default tab',
    (await cdp.eval(`return document.getElementById('tab-overview').getAttribute('aria-selected')`)) === 'true');
  check('only one panel is visible at a time',
    (await cdp.eval(`
      var v = 0;
      document.querySelectorAll('.tabpanel').forEach(function (p) { if (!p.hidden) v++; });
      return v;
    `)) === 1);
  check('the visible panel is the overview',
    (await cdp.eval(`return document.getElementById('panel-overview').hidden`)) === false);

  await goTab('faq');
  check('clicking a tab swaps the visible panel',
    (await cdp.eval(`return document.getElementById('panel-faq').hidden === false
      && document.getElementById('panel-overview').hidden === true`)));
  check('clicking a tab writes its deep link',
    (await cdp.eval(`return location.hash`)) === '#/faq');
  check('the year picker hides on tabs that are not year-scoped',
    (await cdp.eval(`return document.getElementById('subbar').hidden`)) === true);

  await goTab('overview');
  check('the year picker returns on year-scoped tabs',
    (await cdp.eval(`return document.getElementById('subbar').hidden`)) === false);

  await cdp.eval(`document.querySelector('.tab-jump a').click(); return 1`);
  await sleep(400);
  check('an in-page "next step" link switches tabs',
    (await cdp.eval(`return location.hash`)) === '#/detail/2027' &&
    (await cdp.eval(`return document.getElementById('panel-detail').hidden`)) === false);

  await cdp.eval(`
    var t = document.getElementById('tab-detail');
    t.focus();
    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    return 1;
  `);
  await sleep(300);
  check('arrow keys move between tabs',
    (await cdp.eval(`return document.getElementById('panel-compare').hidden`)) === false);
  check('only the selected tab is in the tab order',
    (await cdp.eval(`
      var n = 0;
      document.querySelectorAll('.tabbar [role="tab"]').forEach(function (t) {
        if (t.tabIndex === 0) n++;
      });
      return n;
    `)) === 1);

  await goTab('overview');

  /* ---- drill-down ---- */
  console.log('\nDrill-down');
  await goTab('detail');
  const beforeRows = await cdp.eval(`return document.querySelectorAll('#detail-tree .tree-row').length`);
  await cdp.eval(`document.querySelector('#detail-tree .tree-toggle').click(); return 1`);
  await sleep(200);
  const afterRows = await cdp.eval(`return document.querySelectorAll('#detail-tree .tree-row').length`);
  check('expanding a service area reveals departments', afterRows > beforeRows,
    `${beforeRows} -> ${afterRows}`);

  check('expanded node reports aria-expanded=true',
    (await cdp.eval(`return document.querySelector('#detail-tree .tree-toggle').getAttribute('aria-expanded')`)) === 'true');

  await cdp.eval(`document.querySelector('#detail-tree .tree-toggle').click(); return 1`);
  await sleep(200);
  check('collapsing restores the original rows',
    (await cdp.eval(`return document.querySelectorAll('#detail-tree .tree-row').length`)) === beforeRows);

  // Drill all the way to a leaf line item.
  await cdp.eval(`
    var g = document.getElementById('detail-expand');
    g.click();
    return 1;
  `);
  await sleep(600);
  const depth4 = await cdp.eval(`return document.querySelectorAll('#detail-tree .tree-row--d4').length`);
  check('expand all reaches line-item depth', depth4 > 1000, `${depth4} level-5 rows`);

  // The sum of the deepest rows must equal the published year total.
  const leafSum = await cdp.eval(`
    var rows = document.querySelectorAll('#detail-tree .tree-row--d4 .tree-amount');
    var t = 0;
    rows.forEach(function (r) { t += Number(r.textContent.replace(/[^0-9.-]/g, '')); });
    return Math.round(t);
  `);
  check('line items sum to the FY2027 total', Math.abs(leafSum - 1032959502) <= 42,
    `got $${leafSum.toLocaleString()}`);

  await cdp.eval(`document.getElementById('detail-expand').click(); return 1`);
  await sleep(300);

  /* ---- search ---- */
  console.log('\nLine-item search');
  await cdp.eval(`
    var i = document.getElementById('detail-search');
    i.value = 'overtime';
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return 1;
  `);
  await sleep(400);
  const hits = await cdp.eval(`return document.querySelectorAll('#detail-tree .tree-row--d4').length`);
  check('searching "overtime" finds line items', hits > 5, `${hits} matches`);
  check('search auto-expands to show matches',
    (await cdp.eval(`return document.querySelectorAll('#detail-tree .tree-row--d0').length`)) > 0);

  await cdp.eval(`
    var i = document.getElementById('detail-search');
    i.value = 'zzzznotathing';
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return 1;
  `);
  await sleep(300);
  check('a search with no hits shows an empty state',
    (await cdp.eval(`return document.querySelectorAll('#detail-tree .empty').length`)) === 1);

  await cdp.eval(`
    var i = document.getElementById('detail-search');
    i.value = '';
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return 1;
  `);
  await sleep(300);

  /* ---- multi-year comparison ---- */
  console.log('\nMulti-year comparison');
  await goTab('compare');
  check('defaults to 3 year columns',
    (await cdp.eval(`return document.querySelectorAll('#compare-table thead th').length`)) === 5,
    'name + 3 years + %change');

  const pctText = await cdp.eval(`
    var c = document.querySelector('#compare-table tfoot .chg');
    return c ? c.textContent : null;
  `);
  check('total row shows a percent change', /^[+−]\d+\.\d%$/.test(pctText || ''), pctText);

  await cdp.eval(`document.querySelector('[data-years="all"]').click(); return 1`);
  await sleep(600);
  check('"All" shows every fiscal year',
    (await cdp.eval(`return document.querySelectorAll('#compare-table thead th').length`)) === 19,
    'name + 17 years + %change');

  // Renamed labels must be folded together. If aliasing regressed, a service
  // area would show a gap in the years before or after its rename, which the
  // table renders as an em dash.
  const svcGaps = await cdp.eval(`
    var rows = document.querySelectorAll('#compare-table tbody tr.cmp-d0');
    var bad = [];
    rows.forEach(function (tr) {
      var cells = tr.querySelectorAll('td');
      for (var i = 0; i < cells.length - 1; i++) {
        if (cells[i].textContent.trim() === '\\u2014') {
          bad.push(tr.querySelector('.tree-name').textContent);
          return;
        }
      }
    });
    return bad;
  `);
  check('every service area has a figure in all 17 years', svcGaps.length === 0,
    svcGaps.join(', '));

  const dupDepts = await cdp.eval(`
    var toggles = [...document.querySelectorAll('#compare-table [data-cmp-key]')];
    toggles.forEach(function (b) { b.click(); });
    var names = [...document.querySelectorAll('#compare-table tr.cmp-d1 .tree-name')]
      .map(function (n) { return n.textContent; });
    // Collapse again so later checks start from the default state.
    [...document.querySelectorAll('#compare-table tr.cmp-d0 [data-cmp-key]')]
      .forEach(function (b) { b.click(); });
    var pairs = [['Police','Police Department'],['Fire','Fire Department'],
                 ['Water','Water Department'],['Cable Television','Cable TV']];
    return pairs.filter(function (p) {
      return names.indexOf(p[0]) !== -1 && names.indexOf(p[1]) !== -1;
    }).map(function (p) { return p.join(' + '); });
  `);
  check('renamed departments are not listed twice', dupDepts.length === 0,
    dupDepts.join('; '));

  await cdp.eval(`document.querySelector('[data-years="recent5"]').click(); return 1`);
  await sleep(400);
  check('"Last 5" narrows back to 5 years',
    (await cdp.eval(`return document.querySelectorAll('#compare-table thead th').length`)) === 7);

  // Comparison totals must also tie to the published figure.
  const cmpTotal = await cdp.eval(`
    var cells = document.querySelectorAll('#compare-table tfoot td');
    var last = cells[cells.length - 2];
    return Math.round(Number(last.textContent.replace(/[^0-9.-]/g, '')));
  `);
  check('comparison total ties to FY2027', Math.abs(cmpTotal - 1032959502) <= 42,
    `got $${cmpTotal.toLocaleString()}`);

  await cdp.eval(`document.querySelector('#compare-table [data-cmp-key]').click(); return 1`);
  await sleep(300);
  check('comparison rows expand',
    (await cdp.eval(`return document.querySelectorAll('#compare-table tr.cmp-d1').length`)) > 0);

  /* ---- tooltips ---- */
  console.log('\nTooltips');
  await cdp.eval(`document.querySelector('#panel-compare .tip').click(); return 1`);
  await sleep(250);
  const tipText = await cdp.eval(`
    var b = document.querySelector('.tip-bubble');
    return b ? b.textContent.slice(0, 40) : null;
  `);
  check('clicking a tooltip opens a definition', !!tipText && tipText.length > 20, tipText);

  await cdp.eval(`document.body.click(); return 1`);
  await sleep(250);
  check('clicking away closes the tooltip',
    (await cdp.eval(`return document.querySelectorAll('.tip-bubble').length`)) === 0);

  /* ---- revenues, documents, FAQ ---- */
  console.log('\nContent sections');
  await goTab('revenues');
  check('revenue chart rendered',
    (await cdp.eval(`return document.querySelectorAll('#revenue-chart .bar-row').length`)) === 6);
  await goTab('documents');
  check('documents list rendered from content file',
    (await cdp.eval(`return document.querySelectorAll('#documents-body .doc-list a').length`)) >= 10);
  await goTab('faq');
  check('FAQ rendered from content file',
    (await cdp.eval(`return document.querySelectorAll('#faq-body details').length`)) >= 10);
  check('FAQ answers contain real markup',
    (await cdp.eval(`return document.querySelectorAll('#faq-body .faq__a p').length`)) > 10);

  /* ---- year switching ---- */
  console.log('\nFiscal year switching');
  await goTab('overview');
  await cdp.eval(`
    var s = document.getElementById('fy-select');
    s.value = '2016';
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return 1;
  `);
  await sleep(1500);
  check('switching to FY2016 updates the KPI',
    (await cdp.eval(`return document.getElementById('kpi-total-note').textContent`))
      .indexOf('545,870,875') !== -1);
  check('the year rides in the tab deep link',
    (await cdp.eval(`return location.hash`)) === '#/overview/2016');
  check('the fiscal-year bar echoes the selected year',
    (await cdp.eval(`return document.getElementById('subbar-total').textContent`))
      .indexOf('FY2016') === 0);
  check('tree reloads for the new year',
    (await cdp.eval(`return document.querySelectorAll('#detail-tree .tree-row').length`)) > 0);
  check('historical labels remain visible beside comparison labels',
    (await cdp.eval(`return document.getElementById('detail-tree').textContent`))
      .indexOf('published as Community Maintenance and Development') !== -1);

  /* ---- deep links ---- */
  console.log('\nDeep links');
  const route = async (hash) => {
    await cdp.eval(`location.hash = ${JSON.stringify(hash)}; return 1`);
    await sleep(1600);
  };

  await route('#/detail/2019');
  check('#/detail/2019 opens the right tab',
    (await cdp.eval(`return document.getElementById('panel-detail').hidden`)) === false);
  check('#/detail/2019 also selects the year',
    (await cdp.eval(`return document.getElementById('fy-select').value`)) === '2019');

  await route('#/compare/2011,2019,2027');
  check('#/compare/... restores the chosen years',
    (await cdp.eval(`
      var h = document.querySelectorAll('#compare-table thead th');
      return Array.prototype.map.call(h, function (t) { return t.textContent.trim(); }).join('|');
    `)).indexOf('FY2011') !== -1);
  check('#/compare/... shows only the compare panel',
    (await cdp.eval(`
      var v = [];
      document.querySelectorAll('.tabpanel').forEach(function (p) { if (!p.hidden) v.push(p.id); });
      return v.join(',');
    `)) === 'panel-compare');

  // Links printed on paper or saved before the page had tabs must still work.
  await route('#fy2015');
  check('a pre-tabs #fy2015 bookmark still lands somewhere sensible',
    (await cdp.eval(`return document.getElementById('fy-select').value`)) === '2015');
  check('the legacy bookmark is rewritten to the canonical URL',
    (await cdp.eval(`return location.hash`)) === '#/overview/2015');

  await route('#/nonsense');
  check('an unknown route falls back to the overview',
    (await cdp.eval(`return location.hash`)) === '#/overview/2015');

  await cdp.send('Page.navigate', { url: BASE + '#/revenues/2020' });
  let deepReady = false;
  for (let i = 0; i < 40 && !deepReady; i++) {
    await sleep(500);
    deepReady = await cdp.eval(`
      var s = document.getElementById('status');
      return !!(s && s.hidden) && document.querySelectorAll('#revenue-chart .bar-row').length > 0;
    `).catch(() => false);
  }
  check('a deep link loaded cold opens the right tab and year', deepReady &&
    (await cdp.eval(`return document.getElementById('panel-revenues').hidden === false
      && document.getElementById('fy-select').value === '2020'`)));

  check('still no uncaught exceptions after interaction',
    consoleErrors.length === 0, consoleErrors[0]);

  ws.close();
  proc.kill();
  await rm(profile, { recursive: true, force: true }).catch(() => {});

  console.log(`\n${'='.repeat(58)}`);
  if (failures.length) {
    console.log(`${pass} passed, ${failures.length} FAILED\n`);
    failures.forEach((f) => console.log('  ✗ ' + f));
    process.exit(1);
  }
  console.log(`All ${pass} interaction checks passed.`);
}

main().catch((e) => {
  console.error('\nTest run failed:', e.message);
  process.exit(1);
});
