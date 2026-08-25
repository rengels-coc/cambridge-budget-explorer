# Budget open data normalization rules

## Purpose

These rules make Cambridge's published budget data more consistent for
year-to-year comparison without changing the underlying budget. The normalized
files are review copies. The published open data remains the source of record.

## The decisions in plain English

1. **Keep every source row.** The process does not add, delete, merge, aggregate,
   or deduplicate rows. Each output row carries the Socrata source row ID so it
   can be traced back to the published record.
2. **Never rewrite dollar amounts.** Amounts are converted from JSON text to JSON
   numbers, but their numeric values and dataset totals must remain identical.
   The script stops with an error if a total or row count changes.
3. **Preserve intentional historical names.** Published service, department,
   category, and fund fields remain available as published. Parallel fields such
   as `department_name_comparison` hold the canonical cross-year label. In
   general, that comparison label is the current FY2027 name.
4. **Classify every exact mapping.** A `deliberate_rename` is the same entity
   under a new official name. An `organizational_crosswalk` groups distinct
   source labels only for comparison. Everything else is a `typo_or_format`
   correction.
5. **Correct only unambiguous text errors in place.** Exact spelling,
   capitalization, punctuation, and spacing variants are standardized for
   selected division names, descriptions, capital project names, and locations.
   The rules are an explicit list; the script does not use fuzzy matching.
6. **Make the schema predictable.** Numeric fields become JSON numbers. Optional
   fields that Socrata omits become explicit `null` values. Text is trimmed and
   repeated whitespace is collapsed to one space.
7. **Do not manufacture historical comparability.** A new program, an ended
   program, a departmental transfer, or a change in the level of detail is not
   treated as a typo. Labels that cover only part of the available year range
   are sent to `label-span-review.csv` instead of being changed automatically.
8. **Retain valid accounting behavior.** Negative revenue lines, zero-dollar
   lines, and missing optional capital locations are preserved.
9. **Log every transformation and comparison derivation.**
   `audit/changes-with-provenance.csv` contains the dataset, source row ID,
   fiscal year, field,
   rule class, and before/after values. Copying a published label into its
   comparison field is logged as a derivation, even when the two values match.

## Deliberate comparability choices

The historical service names "Human Resources and Development," "Human Resource
Development," and "Community Maintenance and Development" remain in `service`
while `service_comparison` uses their current names. Known department renames
such as Police to Police Department, Fire to Fire Department, Water to Water
Department, and Cable Television to Cable TV are treated the same way.

The three FY2027 Public Works department labels remain in `department_name` and
are crosswalked to Public Works in `department_name_comparison`. Their separate
divisions remain in the row-level data. This is explicitly classified as an
organizational crosswalk, not a rename.

The FY2026 centralization of employee benefits is **not** reversed. It moved
budget responsibility rather than merely changing a label. Likewise, new
departments such as Community Safety, Housing, Equity and Inclusion, and the
Office of Sustainability remain new.

School division data changes substantially in detail and organization across the
years. This first pass corrects clear typographical and punctuation variants but
does not attempt to build a speculative crosswalk between every old and new
school organizational unit.

## How to run it

From `budget-explorer-poc`:

```text
node scripts/normalize-open-data.mjs
```

That downloads all three current datasets and writes:

- `normalization-output/normalized/*.json` - normalized row-level data
- `normalization-output/audit/report.md` - readable review report
- `normalization-output/audit/changes-with-provenance.csv` - every
  transformation and comparison-field derivation
- `normalization-output/audit/label-span-review.csv` - possible continuity
  issues deliberately left unchanged
- `normalization-output/manifest.json` - sources, timestamps, checksums, and
  validation results

Run selected datasets by repeating `--dataset`:

```text
node scripts/normalize-open-data.mjs --dataset expenditures --dataset revenues
```

Use a saved JSON export instead of the live source:

```text
node scripts/normalize-open-data.mjs --source expenditures=path\to\rows.json
```

The file must be a JSON array or an object with a `rows` array. When a local
export does not include Socrata row IDs, the script assigns deterministic
file-order IDs and records that fact in the manifest.

## Review guidance for the Budget Office

Start with `audit/report.md`. It summarizes what changed and why without listing
thousands of repetitive rows. Use the exact-label table to approve or reject the
crosswalk decisions. Then review `label-span-review.csv`, concentrating on
department and fund labels rather than assuming every partial-year label is an
error. `changes-with-provenance.csv` is the detailed evidence when a particular
count or label needs to be traced to source rows.
