#!/usr/bin/env node
/**
 * Produces row-level normalized copies of Cambridge's three budget datasets.
 *
 * Usage:
 *   node scripts/normalize-open-data.mjs
 *   node scripts/normalize-open-data.mjs --dataset expenditures --dataset revenues
 *   node scripts/normalize-open-data.mjs --source expenditures=path/to/rows.json
 *   node scripts/normalize-open-data.mjs --out path/to/output
 *
 * Local and HTTP source overrides must contain a JSON array (or an object with a
 * `rows` array). Defaults are fetched from Socrata with stable :id paging.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUTPUT = resolve(ROOT, 'normalization-output');
const DEFAULT_ALIASES = resolve(ROOT, 'content', 'aliases.json');
const SOCRATA_RESOURCE = 'https://data.cambridgema.gov/resource/';
const SOCRATA_METADATA = 'https://data.cambridgema.gov/api/views/';
const PAGE_SIZE = 10000;
const AUDIT_CHANGES_FILE = 'changes-with-provenance.csv';

const DATASETS = {
  expenditures: {
    id: '5bn4-5wey',
    title: 'Budget - Operating Expenditures',
    fields: [
      'fiscal_year',
      'service',
      'department_name',
      'division_name',
      'category',
      'description',
      'amount',
      'fund',
    ],
    numericFields: ['fiscal_year', 'amount'],
    amountField: 'amount',
    requiredFields: [
      'fiscal_year',
      'service',
      'department_name',
      'category',
      'description',
      'amount',
      'fund',
    ],
    reviewFields: ['service', 'department_name', 'category', 'fund'],
  },
  revenues: {
    id: 'ixyv-mje6',
    title: 'Budget - Operating Revenues',
    fields: [
      'fiscal_year',
      'service',
      'department_name',
      'category',
      'description',
      'amount',
      'fund',
    ],
    numericFields: ['fiscal_year', 'amount'],
    amountField: 'amount',
    requiredFields: [
      'fiscal_year',
      'service',
      'department_name',
      'category',
      'description',
      'amount',
      'fund',
    ],
    reviewFields: ['service', 'department_name', 'category', 'fund'],
  },
  capital: {
    id: '9chi-2ed3',
    title: 'Budget - Capital',
    fields: [
      'fiscal_year',
      'department',
      'project_id',
      'project_name',
      'fund',
      'city_location',
      'latitude',
      'longitude',
      'map_location',
      'approved_amount',
    ],
    numericFields: ['fiscal_year', 'latitude', 'longitude', 'approved_amount'],
    amountField: 'approved_amount',
    requiredFields: ['fiscal_year', 'department', 'project_name', 'approved_amount'],
    reviewFields: ['department', 'fund'],
  },
};

const ALIAS_GROUP_BY_FIELD = {
  service: 'service',
  department_name: 'department_name',
  department: 'department_name',
  division_name: 'division_name',
  category: 'category',
  fund: 'fund',
  description: 'description',
  city_location: 'city_location',
  project_name: 'project_name',
};
const COMPARISON_ALIAS_GROUPS = new Set(['service', 'department_name', 'category', 'fund']);
const RULE_TYPES = new Set([
  'deliberate_rename',
  'organizational_crosswalk',
  'typo_or_format',
]);

function usage() {
  console.log(`Normalize Cambridge budget open data and write a complete audit trail.

Usage:
  node scripts/normalize-open-data.mjs [options]

Options:
  --dataset NAME       Normalize expenditures, revenues, or capital (repeatable)
  --source NAME=VALUE  Override a source with a local path or HTTP JSON URL
  --out PATH           Output directory (default: normalization-output)
  --aliases PATH       Exact-match alias file (default: content/aliases.json)
  --help               Show this help

With no options, all three live Socrata datasets are normalized.`);
}

function parseArgs(argv) {
  const selected = [];
  const sources = {};
  let out = DEFAULT_OUTPUT;
  let aliases = DEFAULT_ALIASES;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help') return { help: true };
    if (arg === '--dataset') {
      const value = argv[++i];
      if (!value) throw new Error('--dataset requires a name');
      selected.push(value);
      continue;
    }
    if (arg === '--source') {
      const value = argv[++i];
      const split = value?.indexOf('=') ?? -1;
      if (split < 1) throw new Error('--source requires NAME=PATH_OR_URL');
      sources[value.slice(0, split)] = value.slice(split + 1);
      continue;
    }
    if (arg === '--out') {
      const value = argv[++i];
      if (!value) throw new Error('--out requires a path');
      out = pathFromRoot(value);
      continue;
    }
    if (arg === '--aliases') {
      const value = argv[++i];
      if (!value) throw new Error('--aliases requires a path');
      aliases = pathFromRoot(value);
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  const datasets = selected.length ? [...new Set(selected)] : Object.keys(DATASETS);
  for (const name of [...datasets, ...Object.keys(sources)]) {
    if (!DATASETS[name]) {
      throw new Error(`Unknown dataset "${name}". Use expenditures, revenues, or capital.`);
    }
  }
  for (const name of Object.keys(sources)) {
    if (!datasets.includes(name)) datasets.push(name);
  }
  return { datasets, sources, out, aliases, help: false };
}

function pathFromRoot(value) {
  return isAbsolute(value) ? value : resolve(ROOT, value);
}

async function fetchJson(url, attempts = 4) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let response;
    try {
      response = await fetch(url, { headers: { Accept: 'application/json' } });
    } catch (error) {
      if (attempt === attempts) throw error;
      await sleep(attempt * 1000);
      continue;
    }
    if (response.ok) return response.json();
    if (attempt === attempts) {
      throw new Error(`${url} returned HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
    await sleep(attempt * 1000);
  }
}

const sleep = (milliseconds) => new Promise((accept) => setTimeout(accept, milliseconds));

async function readSource(name, spec, override) {
  if (override) {
    const raw = /^https?:\/\//i.test(override)
      ? await fetchJson(override)
      : JSON.parse(await readFile(pathFromRoot(override), 'utf8'));
    const rows = Array.isArray(raw) ? raw : raw.rows;
    if (!Array.isArray(rows)) throw new Error(`${name} source must be a JSON array or contain a rows array`);
    return {
      rows,
      source: override,
      sourceType: /^https?:\/\//i.test(override) ? 'http-json' : 'local-json',
      sourceUpdatedAt: null,
    };
  }

  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const url = new URL(`${SOCRATA_RESOURCE}${spec.id}.json`);
    url.searchParams.set('$limit', String(PAGE_SIZE));
    url.searchParams.set('$offset', String(offset));
    url.searchParams.set('$select', '*, :id as _source_row_id');
    url.searchParams.set('$order', ':id');
    const batch = await fetchJson(url);
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  const metadata = await fetchJson(`${SOCRATA_METADATA}${spec.id}`);
  return {
    rows,
    source: `${SOCRATA_RESOURCE}${spec.id}.json`,
    sourceType: 'socrata',
    sourceUpdatedAt: metadata.rowsUpdatedAt
      ? new Date(metadata.rowsUpdatedAt * 1000).toISOString()
      : null,
  };
}

async function loadAliases(path) {
  const raw = JSON.parse(await readFile(path, 'utf8'));
  const aliases = {};
  for (const group of new Set(Object.values(ALIAS_GROUP_BY_FIELD))) {
    aliases[group] = {};
    for (const [from, to] of Object.entries(raw[group] || {})) {
      if (from.startsWith('_') || typeof to !== 'string') continue;
      const type = raw._ruleTypes?.[group]?.[from] || 'typo_or_format';
      if (!RULE_TYPES.has(type)) throw new Error(`Unknown rule type "${type}" for ${group}.${from}`);
      aliases[group][from] = { to, type };
    }
  }
  return aliases;
}

function comparisonFieldName(field) {
  return `${field}_comparison`;
}

function isComparisonField(field) {
  return COMPARISON_ALIAS_GROUPS.has(ALIAS_GROUP_BY_FIELD[field]);
}

function normalizeDataset(name, spec, sourceRows, aliases) {
  const audits = [];
  const normalized = [];
  const requiredMissing = new Map();
  const sourceIds = new Set();
  const sourceIdMode = sourceRows.every((row) => row._source_row_id) ? 'source' : 'generated';

  for (let index = 0; index < sourceRows.length; index++) {
    const source = sourceRows[index];
    const sourceRowId =
      source._source_row_id || `${name}-local-${String(index + 1).padStart(6, '0')}`;
    if (sourceIds.has(sourceRowId)) throw new Error(`${name}: duplicate source row ID ${sourceRowId}`);
    sourceIds.add(sourceRowId);

    const row = {};
    const extraFields = Object.keys(source)
      .filter((field) => !spec.fields.includes(field) && field !== '_source_row_id')
      .sort();

    for (const field of [...spec.fields, ...extraFields]) {
      const missing = !Object.hasOwn(source, field);
      let value = missing ? null : source[field];

      if (missing) {
        addAudit(audits, {
          name,
          sourceRowId,
          fiscalYear: source.fiscal_year ?? '',
          field,
          kind: 'schema',
          rule: 'schema.missing_to_null',
          before: undefined,
          after: null,
        });
      }

      if (typeof value === 'string' && !spec.numericFields.includes(field)) {
        const cleaned = value.trim().replace(/\s+/g, ' ');
        if (cleaned !== value) {
          addAudit(audits, {
            name,
            sourceRowId,
            fiscalYear: source.fiscal_year ?? '',
            field,
            kind: 'whitespace',
            rule: 'text.trim_and_collapse_whitespace',
            before: value,
            after: cleaned,
          });
          value = cleaned;
        }
      }

      if (spec.numericFields.includes(field) && value != null) {
        const number = toNumber(value, `${name} ${sourceRowId} ${field}`);
        if (typeof value !== 'number') {
          addAudit(audits, {
            name,
            sourceRowId,
            fiscalYear: source.fiscal_year ?? '',
            field,
            kind: 'type',
            rule: 'type.numeric_string_to_number',
            before: value,
            after: number,
          });
        }
        value = number;
      }

      const aliasGroup = ALIAS_GROUP_BY_FIELD[field];
      const alias = value != null && aliasGroup ? aliases[aliasGroup]?.[String(value)] : null;
      if (alias?.type === 'typo_or_format' && alias.to !== value) {
        addAudit(audits, {
          name,
          sourceRowId,
          fiscalYear: source.fiscal_year ?? '',
          field,
          kind: 'correction',
          rule: `correction.${aliasGroup}`,
          ruleType: alias.type,
          before: value,
          after: alias.to,
        });
        value = alias.to;
      }

      row[field] = value;
    }

    for (const field of spec.fields.filter(isComparisonField)) {
      const published = row[field];
      const aliasGroup = ALIAS_GROUP_BY_FIELD[field];
      const alias = published != null ? aliases[aliasGroup]?.[String(published)] : null;
      const comparison =
        alias && alias.type !== 'typo_or_format' ? alias.to : published;
      const comparisonField = comparisonFieldName(field);
      row[comparisonField] = comparison;
      addAudit(audits, {
        name,
        sourceRowId,
        fiscalYear: source.fiscal_year ?? '',
        field: comparisonField,
        kind: 'comparison',
        rule: alias && alias.type !== 'typo_or_format'
          ? `comparison.${alias.type}.${aliasGroup}`
          : 'comparison.copy_published',
        ruleType: alias && alias.type !== 'typo_or_format'
          ? alias.type
          : 'copy_published',
        before: published,
        after: comparison,
      });
    }

    for (const field of spec.requiredFields) {
      if (row[field] == null || row[field] === '') {
        requiredMissing.set(field, (requiredMissing.get(field) || 0) + 1);
      }
    }

    row._source_row_id = sourceRowId;
    normalized.push(row);
  }

  if (requiredMissing.size) {
    const details = [...requiredMissing].map(([field, count]) => `${field} (${count})`).join(', ');
    throw new Error(`${name}: required values are missing after normalization: ${details}`);
  }

  const amountBefore = roundCurrency(sum(sourceRows, spec.amountField));
  const amountAfter = roundCurrency(sum(normalized, spec.amountField));
  if (Math.abs(amountBefore - amountAfter) > 0.005) {
    throw new Error(`${name}: amount total changed from ${amountBefore} to ${amountAfter}`);
  }
  if (normalized.length !== sourceRows.length) throw new Error(`${name}: row count changed`);

  return {
    rows: normalized,
    audits,
    sourceIdMode,
    stats: {
      rows: normalized.length,
      amountField: spec.amountField,
      amountTotal: amountAfter,
      zeroAmounts: normalized.filter((row) => row[spec.amountField] === 0).length,
      negativeAmounts: normalized.filter((row) => row[spec.amountField] < 0).length,
      amountByYear: Object.fromEntries(
        [...new Set(normalized.map((row) => row.fiscal_year))]
          .sort((a, b) => a - b)
          .map((year) => [
            year,
            roundCurrency(
              normalized
                .filter((row) => row.fiscal_year === year)
                .reduce((total, row) => total + row[spec.amountField], 0)
            ),
          ])
      ),
      nullsByField: Object.fromEntries(
        [...spec.fields, ...spec.fields.filter(isComparisonField).map(comparisonFieldName)].map((field) => [
          field,
          normalized.filter((row) => row[field] == null || row[field] === '').length,
        ])
      ),
    },
    labelSpans: buildLabelSpans(
      name,
      normalized,
      spec.reviewFields.map(comparisonFieldName)
    ),
  };
}

function addAudit(
  audits,
  { name, sourceRowId, fiscalYear, field, kind, rule, ruleType = '', before, after }
) {
  audits.push({
    dataset: name,
    source_row_id: sourceRowId,
    fiscal_year: String(fiscalYear),
    field,
    change_kind: kind,
    rule_id: rule,
    rule_type: ruleType,
    before_type: valueType(before),
    before_value: auditValue(before),
    after_type: valueType(after),
    after_value: auditValue(after),
  });
}

function valueType(value) {
  if (value === undefined) return 'missing';
  if (value === null) return 'null';
  return typeof value;
}

function auditValue(value) {
  if (value === undefined) return '(missing)';
  if (value === null) return '(null)';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function toNumber(value, context) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${context}: expected a number, got ${JSON.stringify(value)}`);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${context}: invalid number ${JSON.stringify(value)}`);
  return number;
}

function sum(rows, field) {
  return rows.reduce((total, row) => {
    const value = row[field];
    return total + (value == null ? 0 : toNumber(value, field));
  }, 0);
}

function roundCurrency(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function buildLabelSpans(dataset, rows, fields) {
  const output = [];
  const years = rows.map((row) => Number(row.fiscal_year)).filter(Number.isFinite);
  const datasetFirstYear = years.reduce((minimum, year) => Math.min(minimum, year), Infinity);
  const datasetLastYear = years.reduce((maximum, year) => Math.max(maximum, year), -Infinity);

  for (const field of fields) {
    const labels = new Map();
    for (const row of rows) {
      const label = row[field];
      const year = Number(row.fiscal_year);
      if (label == null || !Number.isFinite(year)) continue;
      const entry = labels.get(label) || { firstYear: year, lastYear: year, rows: 0 };
      entry.firstYear = Math.min(entry.firstYear, year);
      entry.lastYear = Math.max(entry.lastYear, year);
      entry.rows++;
      labels.set(label, entry);
    }
    for (const [label, entry] of labels) {
      if (entry.firstYear === datasetFirstYear && entry.lastYear === datasetLastYear) continue;
      output.push({
        dataset,
        field,
        label,
        first_year: entry.firstYear,
        last_year: entry.lastYear,
        row_count: entry.rows,
        dataset_first_year: datasetFirstYear,
        dataset_last_year: datasetLastYear,
        disposition: 'review_only_not_changed',
      });
    }
  }
  return output.sort(
    (a, b) =>
      a.dataset.localeCompare(b.dataset) ||
      a.field.localeCompare(b.field) ||
      a.label.localeCompare(b.label)
  );
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function countBy(items, key) {
  const counts = {};
  for (const item of items) counts[item[key]] = (counts[item[key]] || 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function aliasApplications(audits) {
  const counts = new Map();
  for (const audit of audits.filter(
    (entry) =>
      ['comparison', 'correction'].includes(entry.change_kind) &&
      entry.before_value !== entry.after_value
  )) {
    const key = JSON.stringify([
      audit.dataset,
      audit.field,
      audit.before_value,
      audit.after_value,
      audit.rule_id,
      audit.rule_type,
    ]);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts]
    .map(([key, count]) => {
      const [dataset, field, before, after, rule_id, rule_type] = JSON.parse(key);
      return { dataset, field, before, after, count, rule_id, rule_type };
    })
    .sort(
      (a, b) =>
        a.dataset.localeCompare(b.dataset) ||
        a.field.localeCompare(b.field) ||
        a.before.localeCompare(b.before)
    );
}

function csv(rows, fields) {
  const escape = (value) => {
    const string = value == null ? '' : String(value);
    return /[",\r\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
  };
  return [
    fields.join(','),
    ...rows.map((row) => fields.map((field) => escape(row[field])).join(',')),
  ].join('\r\n') + '\r\n';
}

function formatMoney(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value);
}

function markdownReport(summary) {
  const lines = [
    '# Budget data normalization audit',
    '',
    `Generated ${summary.generatedAt}.`,
    '',
    '## Executive summary',
    '',
    `The run normalized ${summary.totals.rows.toLocaleString()} rows across ` +
      `${summary.datasets.length} datasets and recorded ` +
      `${summary.totals.changes.toLocaleString()} individual transformations and derivations. ` +
      `Every transformation is listed in \`${AUDIT_CHANGES_FILE}\` with the source row ID and before/after value.`,
    '',
    'No rows were added, removed, merged, or deduplicated. Dollar values were not rewritten, ' +
      'and each dataset total is identical before and after normalization.',
    '',
    '| Dataset | Rows | Source total | Audit entries | Label mappings applied |',
    '| --- | ---: | ---: | ---: | ---: |',
  ];

  for (const dataset of summary.datasets) {
    lines.push(
      `| ${dataset.title} | ${dataset.rows.toLocaleString()} | ` +
        `${formatMoney(dataset.amountTotal)} | ${dataset.changes.toLocaleString()} | ` +
        `${dataset.labelMappings.toLocaleString()} |`
    );
  }

  lines.push(
    '',
    '## Source reconciliation findings',
    ''
  );

  if (summary.operatingReconciliation) {
    const mismatches = summary.operatingReconciliation.filter((entry) => entry.difference !== 0);
    if (mismatches.length) {
      lines.push(
        'The operating datasets do not balance exactly in the two source years below. ' +
          'The normalized files preserve these published differences for Budget Office review.',
        '',
        '| Fiscal year | Expenditures | Revenues | Expenditures minus revenues |',
        '| --- | ---: | ---: | ---: |'
      );
      for (const entry of mismatches) {
        lines.push(
          `| FY${entry.fiscalYear} | ${formatMoney(entry.expenditures)} | ` +
            `${formatMoney(entry.revenues)} | ${formatMoney(entry.difference)} |`
        );
      }
    } else {
      lines.push('Operating expenditures and revenues balance exactly in every shared fiscal year.');
    }
  } else {
    lines.push('A cross-dataset operating reconciliation was not run because both datasets were not selected.');
  }

  lines.push(
    '',
    '## What changed',
    '',
    '| Change class | Count | Meaning |',
    '| --- | ---: | --- |',
    `| Numeric type normalization | ${(summary.changesByKind.type || 0).toLocaleString()} | ` +
      'Socrata JSON numeric strings became JSON numbers. |',
    `| Explicit nulls | ${(summary.changesByKind.schema || 0).toLocaleString()} | ` +
      'Missing optional keys became explicit `null` values for a stable schema. |',
    `| Comparison-field derivations | ${(summary.changesByKind.comparison || 0).toLocaleString()} | ` +
      'Published labels were copied or mapped into parallel cross-year comparison fields. |',
    `| Typo/format corrections | ${(summary.changesByKind.correction || 0).toLocaleString()} | ` +
      'Unambiguous spelling, capitalization, punctuation, or formatting errors were corrected directly. |',
    `| Whitespace cleanup | ${(summary.changesByKind.whitespace || 0).toLocaleString()} | ` +
      'Leading/trailing whitespace was removed and repeated whitespace collapsed. |',
    '',
    '## Exact label mappings applied',
    '',
    '| Dataset | Field | Published value | Comparison/corrected value | Rule class | Rows |',
    '| --- | --- | --- | --- | --- | ---: |'
  );

  for (const alias of summary.aliasApplications) {
    lines.push(
      `| ${escapeMarkdown(alias.dataset)} | ${escapeMarkdown(alias.field)} | ` +
        `${escapeMarkdown(alias.before)} | ${escapeMarkdown(alias.after)} | ` +
        `${escapeMarkdown(alias.rule_type)} | ` +
        `${alias.count.toLocaleString()} |`
    );
  }

  lines.push(
    '',
    '## Items deliberately left for Budget Office review',
    '',
    `${summary.totals.labelSpanFlags.toLocaleString()} label spans begin after or end before their ` +
      'dataset range. They are listed in `label-span-review.csv`; the script did not guess at them. ' +
      'Many are legitimate new programs, ended programs, reorganizations, or changes in publication detail.',
    '',
    'The script also leaves valid negative revenue rows, zero-dollar budget lines, optional capital ' +
      'locations, and the FY2026 employee-benefit centralization untouched.',
    '',
    '| Dataset | Zero-dollar rows | Negative-dollar rows | Review-only label spans |',
    '| --- | ---: | ---: | ---: |'
  );

  for (const dataset of summary.datasets) {
    lines.push(
      `| ${dataset.title} | ${dataset.zeroAmounts.toLocaleString()} | ` +
        `${dataset.negativeAmounts.toLocaleString()} | ${dataset.labelSpanFlags.toLocaleString()} |`
    );
  }

  lines.push(
    '',
    '## Audit files',
    '',
    `- \`${AUDIT_CHANGES_FILE}\` is the complete, row-level record of every transformation.`,
    '- `summary.json` is the machine-readable version of this report.',
    '- `label-span-review.csv` lists possible continuity issues that were not automatically changed.',
    '- `../manifest.json` records source URLs, update timestamps, row counts, checksums, and output files.',
    '- `../normalized/*.json` contains the normalized row-level datasets.',
    '',
    'The plain-English decision rules are in `docs/data-normalization-rules.md`.'
  );
  return lines.join('\n') + '\n';
}

function escapeMarkdown(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  const aliases = await loadAliases(options.aliases);
  const normalizedDir = resolve(options.out, 'normalized');
  const auditDir = resolve(options.out, 'audit');
  await mkdir(normalizedDir, { recursive: true });
  await mkdir(auditDir, { recursive: true });

  const generatedAt = new Date().toISOString();
  let allAudits = [];
  const allLabelSpans = [];
  const manifestDatasets = [];
  const summaryDatasets = [];

  for (const name of options.datasets) {
    const spec = DATASETS[name];
    console.log(`Reading ${name}...`);
    const source = await readSource(name, spec, options.sources[name]);
    console.log(`  ${source.rows.length.toLocaleString()} rows`);

    const result = normalizeDataset(name, spec, source.rows, aliases);
    allAudits = allAudits.concat(result.audits);
    allLabelSpans.push(...result.labelSpans);

    const outputPath = resolve(normalizedDir, `${name}.json`);
    await writeFile(outputPath, JSON.stringify(result.rows, null, 2) + '\n', 'utf8');

    manifestDatasets.push({
      name,
      title: spec.title,
      datasetId: spec.id,
      source: source.source,
      sourceType: source.sourceType,
      sourceUpdatedAt: source.sourceUpdatedAt,
      sourceRowIdMode: result.sourceIdMode,
      rows: result.rows.length,
      sourceSha256: hash(source.rows),
      normalizedSha256: hash(result.rows),
      normalizedFile: `normalized/${name}.json`,
    });
    summaryDatasets.push({
      name,
      title: spec.title,
      rows: result.stats.rows,
      amountField: result.stats.amountField,
      amountTotal: result.stats.amountTotal,
      zeroAmounts: result.stats.zeroAmounts,
      negativeAmounts: result.stats.negativeAmounts,
      amountByYear: result.stats.amountByYear,
      nullsByField: result.stats.nullsByField,
      changes: result.audits.length,
      labelMappings: aliasApplications(result.audits)
        .reduce((total, entry) => total + entry.count, 0),
      labelSpanFlags: result.labelSpans.length,
    });
  }

  const summary = {
    generatedAt,
    rulesFile: 'content/aliases.json',
    datasets: summaryDatasets,
    totals: {
      rows: summaryDatasets.reduce((total, dataset) => total + dataset.rows, 0),
      changes: allAudits.length,
      labelMappings: aliasApplications(allAudits)
        .reduce((total, entry) => total + entry.count, 0),
      labelSpanFlags: allLabelSpans.length,
    },
    changesByKind: countBy(allAudits, 'change_kind'),
    changesByRule: countBy(allAudits, 'rule_id'),
    aliasApplications: aliasApplications(allAudits),
  };
  const expenditures = summaryDatasets.find((dataset) => dataset.name === 'expenditures');
  const revenues = summaryDatasets.find((dataset) => dataset.name === 'revenues');
  if (expenditures && revenues) {
    const years = [...new Set([
      ...Object.keys(expenditures.amountByYear),
      ...Object.keys(revenues.amountByYear),
    ])].sort();
    summary.operatingReconciliation = years.map((fiscalYear) => {
      const expenditureTotal = expenditures.amountByYear[fiscalYear] ?? null;
      const revenueTotal = revenues.amountByYear[fiscalYear] ?? null;
      return {
        fiscalYear: Number(fiscalYear),
        expenditures: expenditureTotal,
        revenues: revenueTotal,
        difference:
          expenditureTotal == null || revenueTotal == null
            ? null
            : roundCurrency(expenditureTotal - revenueTotal),
      };
    });
  }

  const auditFields = [
    'dataset',
    'source_row_id',
    'fiscal_year',
    'field',
    'change_kind',
    'rule_id',
    'rule_type',
    'before_type',
    'before_value',
    'after_type',
    'after_value',
  ];
  const spanFields = [
    'dataset',
    'field',
    'label',
    'first_year',
    'last_year',
    'row_count',
    'dataset_first_year',
    'dataset_last_year',
    'disposition',
  ];

  await writeFile(
    resolve(auditDir, AUDIT_CHANGES_FILE),
    csv(allAudits, auditFields),
    'utf8'
  );
  await writeFile(
    resolve(auditDir, 'label-span-review.csv'),
    csv(allLabelSpans, spanFields),
    'utf8'
  );
  await writeFile(resolve(auditDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf8');
  await writeFile(resolve(auditDir, 'report.md'), markdownReport(summary), 'utf8');

  const manifest = {
    generatedAt,
    script: 'scripts/normalize-open-data.mjs',
    aliases: 'content/aliases.json',
    documentation: 'docs/data-normalization-rules.md',
    dataModel: {
      publishedFieldsPreservedFor: ['deliberate_rename', 'organizational_crosswalk'],
      typoOrFormatCorrectionsAppliedInPlace: true,
      comparisonFields: Object.fromEntries(
        options.datasets.map((name) => [
          name,
          DATASETS[name].fields
            .filter(isComparisonField)
            .map(comparisonFieldName),
        ])
      ),
    },
    datasets: manifestDatasets,
    files: {
      report: 'audit/report.md',
      completeAudit: `audit/${AUDIT_CHANGES_FILE}`,
      reviewQueue: 'audit/label-span-review.csv',
      summary: 'audit/summary.json',
    },
    verification: {
      rowCountsPreserved: true,
      amountTotalsPreserved: true,
      uniqueSourceRowIds: true,
      requiredFieldsPresent: true,
      publishedRenameLabelsPreserved: true,
      comparisonFieldsPresent: true,
    },
  };
  await writeFile(resolve(options.out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  console.log(
    `Wrote ${summary.totals.rows.toLocaleString()} normalized rows and ` +
      `${summary.totals.changes.toLocaleString()} audited transformations to ` +
      `${options.out}`
  );
}

main().catch((error) => {
  console.error(`Normalization failed: ${error.message}`);
  process.exitCode = 1;
});
