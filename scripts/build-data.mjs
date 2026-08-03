#!/usr/bin/env node
/**
 * Builds a static snapshot of the Cambridge budget data into ./data.
 *
 * Pulls every row from the three budget datasets once, then does all the
 * aggregation locally. That is fewer API calls than querying per view, and it
 * lets us build the full hierarchy (service > department > division >
 * category > line item) that the drill-down and multi-year table need.
 *
 * The site works without this — it falls back to querying Socrata directly
 * from the browser. Running this on a schedule means the published page keeps
 * working if the portal is slow, and gives you a git-tracked record of exactly
 * what was shown on any given day.
 *
 * Usage:  node scripts/build-data.mjs
 * Requires Node 18+ (global fetch). No npm dependencies.
 */

import { mkdir, writeFile, readdir, unlink, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'data');

const BASE = 'https://data.cambridgema.gov/resource/';
const DATASETS = {
  expenditures: '5bn4-5wey',
  revenues: 'ixyv-mje6',
  capital: '9chi-2ed3',
};

const APP_TOKEN = process.env.SOCRATA_APP_TOKEN || '';
const PAGE = 10000;

async function get(dataset, params) {
  const url = new URL(BASE + dataset + '.json');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const headers = { Accept: 'application/json' };
  if (APP_TOKEN) headers['X-App-Token'] = APP_TOKEN;

  for (let attempt = 1; attempt <= 4; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers });
    } catch (e) {
      if (attempt === 4) throw new Error(`${dataset}: ${e.message}`);
      await new Promise((r) => setTimeout(r, attempt * 2000));
      continue;
    }
    if (res.ok) return res.json();
    if (attempt === 4) {
      throw new Error(`${dataset} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    await new Promise((r) => setTimeout(r, attempt * 2000));
  }
}

/**
 * Pull every row of a dataset, following Socrata's offset paging.
 *
 * Paging MUST be ordered by a unique key. Ordering by non-unique columns
 * (fiscal_year, department...) lets rows shift between pages, so you silently
 * get duplicates on one page and omissions on another — the row count still
 * looks right while the totals are wrong. `:id` is Socrata's unique system
 * column, which makes the page boundaries stable.
 */
async function getAll(dataset) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const batch = await get(dataset, {
      $limit: String(PAGE),
      $offset: String(offset),
      $order: ':id',
    });
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}

const n = (v) => {
  const x = parseFloat(v);
  return Number.isFinite(x) ? x : 0;
};
const clean = (s) => (s == null || String(s).trim() === '' ? 'Unspecified' : String(s).trim());
const round = (x) => Math.round(x * 100) / 100;

/* ------------------------------------------------------------------ *
 * Label normalisation
 *
 * Cambridge relabels service areas, departments, categories and funds
 * from time to time. The open data keeps whatever label was in use that
 * year, so "Police" (FY2011-FY2026) and "Police Department" (FY2027) are
 * the same department wearing two names. Left alone, every multi-year
 * view shows one of them ending and the other starting.
 *
 * content/aliases.json maps historical labels onto the current one. It is
 * deliberately a reviewable content file rather than code.
 * ------------------------------------------------------------------ */

const ALIAS_FIELDS = ['service', 'department_name', 'category', 'fund'];
let ALIASES = {};

async function loadAliases() {
  try {
    const raw = JSON.parse(await readFile(resolve(ROOT, 'content', 'aliases.json'), 'utf8'));
    for (const f of ALIAS_FIELDS) {
      const map = raw[f];
      if (!map) continue;
      ALIASES[f] = Object.fromEntries(
        Object.entries(map).filter(([k, v]) => !k.startsWith('_') && typeof v === 'string')
      );
    }
    const total = Object.values(ALIASES).reduce((s, m) => s + Object.keys(m).length, 0);
    console.log(`Loaded ${total} label aliases from content/aliases.json`);
  } catch (e) {
    console.warn(`No usable content/aliases.json (${e.message}) - labels left as published.`);
    ALIASES = {};
  }
}

/** Rewrite renamed labels in place so every downstream view is consistent. */
function applyAliases(rows) {
  let changed = 0;
  for (const r of rows) {
    for (const f of ALIAS_FIELDS) {
      const map = ALIASES[f];
      if (!map || r[f] == null) continue;
      const to = map[String(r[f]).trim()];
      if (to) {
        r[f] = to;
        changed++;
      }
    }
  }
  return changed;
}

/**
 * Report labels that do not appear in every fiscal year and were not
 * aliased. Some are real (a department that genuinely did not exist yet);
 * some are renames nobody has told us about. Either way, a human should
 * look, so this prints rather than throws.
 */
function reportLabelGaps(name, rows, years) {
  const spans = new Map();
  for (const r of rows) {
    const y = String(r.fiscal_year);
    for (const f of ALIAS_FIELDS) {
      if (r[f] == null) continue;
      const key = f + '\u0000' + clean(r[f]);
      const cur = spans.get(key);
      if (cur) {
        if (y < cur.min) cur.min = y;
        if (y > cur.max) cur.max = y;
      } else {
        spans.set(key, { min: y, max: y });
      }
    }
  }

  const first = years[0];
  const last = years[years.length - 1];
  const gaps = [...spans.entries()]
    .filter(([, s]) => s.min !== first || s.max !== last)
    .map(([key, s]) => {
      const [field, label] = key.split('\u0000');
      return { field, label, min: s.min, max: s.max };
    })
    .sort((a, b) => a.field.localeCompare(b.field) || a.label.localeCompare(b.label));

  if (gaps.length) {
    console.log(`  ${name}: ${gaps.length} label(s) do not span FY${first}-FY${last}:`);
    for (const g of gaps) {
      console.log(`    ${g.field.padEnd(16)} ${g.label.padEnd(42)} FY${g.min}-FY${g.max}`);
    }
  }
  return gaps;
}

/** Sum `amount` grouped by one field, sorted descending. */
function groupSum(rows, field) {
  const m = new Map();
  for (const r of rows) {
    const k = clean(r[field]);
    m.set(k, (m.get(k) || 0) + n(r.amount));
  }
  return [...m.entries()]
    .map(([label, value]) => ({ label, value: round(value) }))
    .sort((a, b) => b.value - a.value);
}

/**
 * Build a nested tree from an ordered list of grouping fields.
 * Every node carries its own summed total; leaves carry no children.
 */
function buildTree(rows, fields) {
  const root = new Map();

  for (const r of rows) {
    const amount = n(r.amount);
    let level = root;
    for (const f of fields) {
      const key = clean(r[f]);
      if (!level.has(key)) level.set(key, { name: key, total: 0, kids: new Map() });
      const node = level.get(key);
      node.total += amount;
      level = node.kids;
    }
  }

  const toArray = (m, depth) =>
    [...m.values()]
      .sort((a, b) => b.total - a.total)
      .map((x) => {
        const out = { name: x.name, total: round(x.total) };
        if (x.kids.size && depth < fields.length - 1) out.kids = toArray(x.kids, depth + 1);
        return out;
      });

  return toArray(root, 0);
}

/**
 * Multi-year matrix: same idea, but each node holds a {year: amount} map.
 * This is what the side-by-side fiscal year comparison table reads.
 */
function buildMatrix(rows, fields, years) {
  const newest = years[years.length - 1];
  const root = new Map();

  for (const r of rows) {
    const fy = String(r.fiscal_year);
    const amount = n(r.amount);
    let level = root;
    for (const f of fields) {
      const key = clean(r[f]);
      if (!level.has(key)) level.set(key, { name: key, byYear: {}, kids: new Map() });
      const node = level.get(key);
      node.byYear[fy] = (node.byYear[fy] || 0) + amount;
      level = node.kids;
    }
  }

  const toArray = (m, depth) =>
    [...m.values()]
      .sort((a, b) => (b.byYear[newest] || 0) - (a.byYear[newest] || 0))
      .map((x) => {
        const byYear = {};
        for (const y of years) if (x.byYear[y]) byYear[y] = round(x.byYear[y]);
        const out = { name: x.name, byYear };
        if (x.kids.size && depth < fields.length - 1) out.kids = toArray(x.kids, depth + 1);
        return out;
      });

  return toArray(root, 0);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await loadAliases();

  console.log('Downloading expenditures...');
  const exp = await getAll(DATASETS.expenditures);
  console.log(`  ${exp.length.toLocaleString()} rows`);

  console.log('Downloading revenues...');
  const rev = await getAll(DATASETS.revenues);
  console.log(`  ${rev.length.toLocaleString()} rows`);

  console.log('Downloading capital...');
  const cap = await getAll(DATASETS.capital);
  console.log(`  ${cap.length.toLocaleString()} rows`);

  const years = [...new Set(exp.map((r) => String(r.fiscal_year)))].filter(Boolean).sort();
  console.log(`\nFiscal years: FY${years[0]}\u2013FY${years[years.length - 1]} (${years.length})\n`);

  console.log('Normalising renamed labels...');
  console.log(`  expenditures: ${applyAliases(exp).toLocaleString()} field(s) rewritten`);
  console.log(`  revenues:     ${applyAliases(rev).toLocaleString()} field(s) rewritten`);
  console.log(`  capital:      ${applyAliases(cap).toLocaleString()} field(s) rewritten`);

  console.log('\nChecking for labels that may be unhandled renames...');
  const gaps = [
    ...reportLabelGaps('expenditures', exp, years),
    ...reportLabelGaps('revenues', rev, years),
  ];
  await writeFile(
    resolve(OUT, 'label-gaps.json'),
    JSON.stringify(
      {
        note:
          'Labels that do not appear in every fiscal year after aliasing. Some are ' +
          'genuine (a department that did not exist yet); others may be renames that ' +
          'should be added to content/aliases.json.',
        builtAt: new Date().toISOString(),
        gaps,
      },
      null,
      2
    ),
    'utf8'
  );
  console.log('');

  const bucket = (rows) => {
    const m = new Map(years.map((y) => [y, []]));
    for (const r of rows) {
      const y = String(r.fiscal_year);
      if (m.has(y)) m.get(y).push(r);
    }
    return m;
  };

  const expByYear = bucket(exp);
  const revByYear = bucket(rev);
  const capByYear = bucket(cap);

  /* ---- trend ---- */
  const trend = years.map((y) => ({
    year: y,
    value: round(expByYear.get(y).reduce((s, r) => s + n(r.amount), 0)),
  }));
  await writeFile(resolve(OUT, 'trend.json'), JSON.stringify(trend), 'utf8');

  /* ---- stacked composition by service across years ---- */
  const newest = years[years.length - 1];
  const newestTotals = new Map(
    groupSum(expByYear.get(newest), 'service').map((s) => [s.label, s.value])
  );
  const allServices = [...new Set(exp.map((r) => clean(r.service)))].sort(
    (a, b) => (newestTotals.get(b) || 0) - (newestTotals.get(a) || 0)
  );

  const composition = {
    years,
    series: allServices.map((svc) => ({
      label: svc,
      data: years.map((y) =>
        round(
          expByYear
            .get(y)
            .filter((r) => clean(r.service) === svc)
            .reduce((s, r) => s + n(r.amount), 0)
        )
      ),
    })),
  };
  await writeFile(resolve(OUT, 'composition.json'), JSON.stringify(composition), 'utf8');

  /* ---- multi-year comparison matrix ---- */
  const matrix = {
    years,
    expenses: buildMatrix(exp, ['service', 'department_name', 'division_name'], years),
    revenues: buildMatrix(rev, ['category', 'department_name'], years),
  };
  await writeFile(resolve(OUT, 'matrix.json'), JSON.stringify(matrix), 'utf8');

  /* ---- per-year detail ---- */
  const index = {};

  for (const fy of years) {
    const e = expByYear.get(fy);
    const rv = revByYear.get(fy);
    const cp = capByYear.get(fy);

    const services = groupSum(e, 'service');
    const total = round(services.reduce((s, r) => s + r.value, 0));

    const deptMap = new Map();
    for (const r of e) {
      const d = clean(r.department_name);
      if (!deptMap.has(d)) deptMap.set(d, { department: d, service: clean(r.service), total: 0 });
      deptMap.get(d).total += n(r.amount);
    }
    const departments = [...deptMap.values()]
      .map((d) => ({ ...d, total: round(d.total) }))
      .sort((a, b) => b.total - a.total);

    const capitalProjects = cp
      .filter((r) => n(r.approved_amount) > 0)
      .map((r) => ({
        project: clean(r.project_name),
        department: clean(r.department),
        fund: clean(r.fund),
        amount: n(r.approved_amount),
      }))
      .sort((a, b) => b.amount - a.amount);

    const payload = {
      year: fy,
      total,
      services,
      categories: groupSum(e, 'category'),
      funds: groupSum(e, 'fund'),
      departments,
      // Full drill-down: service > department > division > category > line item
      tree: buildTree(e, ['service', 'department_name', 'division_name', 'category', 'description']),
      revenue: round(rv.reduce((s, r) => s + n(r.amount), 0)),
      revenueCategories: groupSum(rv, 'category'),
      revenueTree: buildTree(rv, ['category', 'department_name', 'description']),
      capital: round(cp.reduce((s, r) => s + n(r.approved_amount), 0)),
      capitalProjects: capitalProjects.slice(0, 25),
      lineItemCount: e.length,
    };

    await writeFile(resolve(OUT, `fy-${fy}.json`), JSON.stringify(payload), 'utf8');

    index[fy] = { total, departments: departments.length, lineItems: e.length };
    console.log(
      `  FY${fy}  $${(total / 1e6).toFixed(1).padStart(7)}M  ` +
        `${String(departments.length).padStart(2)} depts  ` +
        `${String(e.length).padStart(5)} line items`
    );
  }

  /* ---- drop snapshots for years that no longer exist upstream ---- */
  const keep = new Set(years.map((y) => `fy-${y}.json`));
  for (const f of await readdir(OUT)) {
    if (/^fy-\d{4}\.json$/.test(f) && !keep.has(f)) {
      await unlink(resolve(OUT, f));
      console.log(`  removed stale ${f}`);
    }
  }

  const manifest = {
    generated: new Date().toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
    source: 'https://data.cambridgema.gov',
    datasets: DATASETS,
    years,
    index,
    counts: { expenditures: exp.length, revenues: rev.length, capital: cap.length },
    aliasesApplied: Object.fromEntries(
      Object.entries(ALIASES).map(([f, m]) => [f, Object.keys(m).length])
    ),
  };
  await writeFile(resolve(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  console.log(`\nWrote ${years.length + 4} files to data/  (generated ${manifest.generated})`);

  await verifyFilesOnDisk();
  await verify(trend);
}

/**
 * Read every file back and parse it. `writeFile` resolving is not proof that
 * the bytes landed — a zero-byte fy-2013.json shipped once because something
 * clobbered the file after the write returned, and nothing downstream noticed:
 * the totals still reconciled, because reconciliation checks what we computed
 * in memory, not what is on disk. A truncated year only fails for the resident
 * who happens to pick that year, which is exactly the kind of silent failure
 * this project is meant to avoid.
 */
async function verifyFilesOnDisk() {
  console.log('\nVerifying the files that actually landed on disk...');

  const files = (await readdir(OUT)).filter((f) => f.endsWith('.json'));
  const bad = [];

  for (const f of files) {
    const raw = await readFile(resolve(OUT, f), 'utf8').catch((e) => {
      bad.push(`${f}: unreadable (${e.message})`);
      return null;
    });
    if (raw == null) continue;
    if (!raw.length) { bad.push(`${f}: zero bytes`); continue; }
    try {
      JSON.parse(raw);
    } catch (e) {
      bad.push(`${f}: not valid JSON (${e.message})`);
    }
  }

  if (bad.length) {
    console.error('\nBAD OUTPUT — files were written but are not usable:');
    for (const b of bad) console.error('  ' + b);
    throw new Error(`${bad.length} of ${files.length} output files failed`);
  }

  console.log(`  OK — all ${files.length} files are present and parse.`);
}

/**
 * Reconcile our locally-computed yearly totals against Socrata's own
 * server-side SUM. These are two independent paths to the same number, so a
 * mismatch means we mis-paged, dropped or double-counted rows. Fail loudly:
 * publishing budget figures that are quietly wrong is the worst outcome here.
 */
async function verify(trend) {
  console.log('\nVerifying totals against server-side sums...');

  const truth = await get(DATASETS.expenditures, {
    $select: 'fiscal_year,sum(amount) as total',
    $group: 'fiscal_year',
  });
  const expected = new Map(truth.map((r) => [String(r.fiscal_year), round(n(r.total))]));

  const bad = [];
  for (const { year, value } of trend) {
    const want = expected.get(year);
    if (want == null) {
      bad.push(`FY${year}: no server-side total to compare`);
    } else if (Math.abs(want - value) > 0.5) {
      bad.push(`FY${year}: built $${value.toLocaleString()} but portal says $${want.toLocaleString()}`);
    }
  }

  if (bad.length) {
    console.error('\nMISMATCH — snapshot does not reconcile with the source:');
    for (const b of bad) console.error('  ' + b);
    throw new Error(`${bad.length} of ${trend.length} fiscal years failed reconciliation`);
  }

  console.log(`  OK — all ${trend.length} fiscal years reconcile exactly.`);
}

main().catch((err) => {
  console.error('\nBuild failed:', err.message);
  process.exit(1);
});
