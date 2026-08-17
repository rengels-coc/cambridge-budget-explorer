# Cambridge Budget Explorer — static proof of concept

A working demonstration that a City budget transparency portal can be a **plain
static website** — no server, no database, no accounts, no third-party
JavaScript — fed directly from the open budget data Cambridge already publishes
on [data.cambridgema.gov](https://data.cambridgema.gov).

Built as a proof of concept for the City of Cambridge.

---

## What it does

| | |
|---|---|
| **Fiscal year selector** | FY2011 – FY2027, straight from the data |
| **Summary figures** | Operating budget, year-over-year change, budgeted revenues, capital budget |
| **Spending by service area** | Ranked bars, with a "view as table" toggle |
| **Spending by category** | Salaries, ordinary maintenance, travel & training, etc. |
| **Budget over time** | Seventeen fiscal years, selected year highlighted |
| **Composition over time** | Stacked chart showing how the mix of service areas has shifted |
| **Drill-down explorer** | Service → department → division → category → line item, five levels, expand/collapse, search, CSV export |
| **Year-over-year comparison** | Pick any set of fiscal years; side-by-side columns with % change, expandable to department level, CSV export |
| **Revenues** | Where the money comes from — chart plus a category → source → fund tree |
| **Departments** | All ~62 departments, searchable, sortable by size, CSV export |
| **Capital projects** | Largest approved capital funding for the selected year |
| **Plain-language tooltips** | Every service area, category, fund and revenue type has a definition, from an editable content file |
| **Budget documents** | Curated links to the adopted budget books, CAFRs and the open data portal |
| **FAQ** | Ten common questions about how to read the numbers |
| **Shareable links** | Every tab has its own URL — see below |

## Tabs and URLs

Each section is a real tab with a bookmarkable address. Routes are hash-based
because GitHub Pages serves static files with no rewrite rules: a path like
`/faq` would 404 on reload, whereas a hash always survives.

| URL | Opens |
| --- | --- |
| `#/overview/2027` | Overview, FY2027 |
| `#/trends` | Budget over time and how the mix has changed |
| `#/detail/2016` | Drill-down tree, FY2016 |
| `#/compare/2011,2019,2027` | Comparison table with those three years selected |
| `#/revenues/2027` | Where the money comes from |
| `#/capital/2027` | Capital projects |
| `#/documents`, `#/faq`, `#/about` | Reference sections |

Tabs scoped to a single fiscal year (overview, detail, revenues, capital) carry
the year in the URL and show the fiscal-year picker; the others do not. Links
from before the page had tabs still work — `#fy2015` is accepted and quietly
rewritten to `#/overview/2015`, and an unrecognised route falls back to the
overview rather than showing an empty page.

Tabs are ordinary `<a href>` elements with `role="tab"`, so ctrl/cmd-click opens
them in a new window and arrow keys move between them per the WAI-ARIA practice.
Printing overrides the hidden panels, so a print-out contains every section.

## What it is made of

```
index.html                       nine tab panels in one document
assets/css/style.css             Cambridge palette, responsive, print styles
assets/js/app.js                 ~1,400 lines of vanilla JS, hand-drawn SVG charts, hash router
assets/img/cambridge-seal.png    City seal, used in the masthead and as the favicon
assets/fonts/*.woff2             Public Sans + League Gothic subsets (SIL OFL, see OFL.txt)
content/glossary.json            plain-language definitions   ─┐
content/documents.json           links to budget documents     │
content/faq.json                 frequently asked questions    ├─ Budget Office owns
content/aliases.json             historical name normalisation ─┘   these, not IT
scripts/build-data.mjs           snapshot builder + reconciliation (Node built-ins only)
scripts/interaction-test.mjs     51 browser checks over the DevTools Protocol
.github/workflows/               daily snapshot + Pages deploy
```

**Total third-party dependencies: zero.** No npm install. No `node_modules`.
No lockfile. Nothing to patch when a CVE lands, because there is nothing there.

That is the main architectural argument this project is making. A conventional
database-backed portal of this kind carries several hundred npm packages, and
each one is a thing somebody has to keep patched for as long as the site is up.

## Content the Budget Office can edit without a developer

The three files in `content/` are what stands in for an admin UI. They
are plain JSON, they are edited in a browser on github.com, and a change to any
of them redeploys the site in about a minute. Nothing in them touches a
database, and a malformed file degrades to the section simply not appearing
rather than to a broken page.

| File | Controls |
|---|---|
| `glossary.json` | The definition behind every ⓘ tooltip |
| `documents.json` | The Budget documents section |
| `faq.json` | The FAQ section |
| `aliases.json` | Which historical department/service names get folded together (see below) |

`glossary.json`, `faq.json` and `aliases.json` are currently marked
`"_status": "draft-needs-budget-office-review"`. The text was written from
standard Massachusetts municipal accounting usage and is **not authoritative**
until the Budget Office reviews it.

## Departments get renamed. That silently breaks year-over-year comparison.

The published data records whatever label was in use in a given fiscal year.
Between FY2011 and FY2027 the City has relabelled a lot:

| Was | Is now |
|---|---|
| Police, Fire | Police Department, Fire Department |
| Water, Cable Television | Water Department, Cable TV |
| Community Maintenance **and Development** | Community Maintenance |
| Human Resources and Development → Human Resource Development | Human Resource |
| Commission on the Status of Women | Women's Commission |
| Salaries **and** Wages, Travel **and** Training | Salaries **&** Wages, Travel **&** Training |
| Fines & Forfeits, Charges For Services | Fines and Forfeits, Charges for Service |

Left alone, a multi-year table shows the Police Department appearing brand new
in FY2027 with sixteen empty columns beside it, and the old Police line stopping
dead. Roughly thirty labels are affected across service areas, departments,
categories and funds.

`content/aliases.json` folds the historical spellings onto the current one. Two
safeguards go with it:

1. The build prints — and writes to `data/label-gaps.json` — every label that
   does *not* appear in all seventeen years and was *not* aliased. Some are
   genuine (Office of Sustainability really is new in FY2025); others are
   renames nobody has told us about yet. Either way a human sees them.
2. `interaction-test.mjs` asserts that no service area has a gap in any year and
   that no known rename pair appears twice in the same table.

**Two changes are deliberately *not* folded**, because they moved money rather
than renaming it:

- **FY2026 — employee benefits were centralised.** Health insurance and pensions
  used to sit inside each department's salary line; from FY2026 they are budgeted
  centrally under General Government. Public Safety salaries drop from $180.9M to
  $120.1M while the central Insurance and Pension lines rise by $107.5M. Nobody's
  staffing changed. Citywide totals are unaffected.
- **FY2027 — Public Works was reorganised** into three departments. Those *are*
  folded back to one line for comparability, but the underlying divisions are
  still visible in the drill-down.

The page says all of this on screen, next to the comparison table, rather than
burying it in a README.

## Where the data comes from

Three datasets on the City's Socrata open data portal, all published by the
Budget Office, all public domain:

| Dataset | ID |
|---|---|
| Budget – Operating Expenditures | `5bn4-5wey` |
| Budget – Operating Revenues | `ixyv-mje6` |
| Budget – Capital | `9chi-2ed3` |

These contain **budgeted** amounts — what was adopted in the annual budget, not
year-end actuals and not individual payments.

Socrata does the aggregation server-side using SoQL, so the browser downloads
summaries rather than rows. The FY2026 service-area breakdown, for example, is a
**329-byte** response that returns in about **340 ms**:

```
https://data.cambridgema.gov/resource/5bn4-5wey.json
  ?$select=service,sum(amount) as total
  &$where=fiscal_year=2026
  &$group=service
  &$order=total DESC
```

The portal sends `Access-Control-Allow-Origin: *`, so the browser can call it
directly with no proxy and no API key.

## Two ways to run it

**Live mode (default).** Open `index.html` from any web server and it queries
Socrata as you click. Nothing to build. Always current with the portal. Every
section works in this mode, including the drill-down, the stacked composition
chart and the year-over-year comparison — they just cost two or three extra API
calls on load.

**Snapshot mode (recommended for a published page).** Run:

```bash
node scripts/build-data.mjs
```

This fetches every expenditure, revenue and capital row once (about 46,000 rows),
aggregates them locally, and writes `data/manifest.json`, `data/trend.json`,
`data/composition.json`, `data/matrix.json` and one `data/fy-YYYY.json` per
fiscal year — roughly 2 MB in total, largest single file 152 KB. If
`data/manifest.json` is present, the page reads those files instead of calling
the API, and falls back to live queries if any file is missing. The included
GitHub Actions workflow runs this nightly and redeploys.

Snapshot mode means the page keeps working if the open data portal is slow or
down, and — because the JSON is committed — you have a dated record of exactly
what the public was shown on any given day.

### The build reconciles itself, and fails loudly

After aggregating locally, `build-data.mjs` asks Socrata for its own
server-computed `sum(amount)` grouped by fiscal year and compares the two. Any
disagreement over fifty cents throws and exits non-zero, so the workflow fails
and the bad snapshot is never published.

This is not theoretical. An earlier version of the build paged through the API
ordered by `fiscal_year, service, department_name` — columns that are not
unique. Rows shifted between pages, and the result had the **correct row count
for every year** but silently wrong totals: FY2014 came out $475.0M instead of
$507.2M. The fix is to page on Socrata's unique `:id` system column, which the
script now does. **Anyone modifying `getAll()` must keep `$order=:id`.**

## Tests

```bash
python -m http.server 8080     # in one terminal
node scripts/interaction-test.mjs
```

`interaction-test.mjs` drives Microsoft Edge headlessly over the Chrome DevTools
Protocol using Node 22's built-in `WebSocket` — no npm packages, consistent with
the rest of the project. It runs 51 checks against the real post-click DOM:
every section renders, the tabs swap panels and write their deep links, the
drill-down expands, search filters, the year picker works, every route
(including pre-tabs bookmarks and a cold-loaded deep link) resolves correctly,
and no uncaught exception occurs before or after interaction.

The most valuable assertions are arithmetic and structural: the FY2027 line items
must sum to exactly $1,032,959,502, the comparison table's total column must tie
to the same figure, every service area must have a figure in all seventeen years,
and no renamed department may appear twice. Those catch data-layer regressions
that look fine on screen.

## Local preview

```bash
# any static server works; this one needs no install
npx --yes serve .
# or
python -m http.server 8080
```

Then open <http://localhost:8080>. Opening `index.html` directly with `file://`
will not work — browsers block `fetch` from `file://` origins.

## Publishing to GitHub Pages

1. Push to a GitHub repository.
2. Settings → Pages → Source: **GitHub Actions**.
3. The workflow builds the snapshot and deploys on push, on a daily schedule,
   and on demand.

Optional: set a repository secret `SOCRATA_APP_TOKEN` to raise the API rate
limit. It is not required and is never exposed to the browser — only the build
job uses it.

## Design notes

The look and feel is drawn from `cambridgema.gov` — everything on this list was
reproduced from the City's own stylesheet, which is public. No City-licensed
asset is copied into this repository.

- **Cambridge palette** — navy `#213a7f`, red `#d72524`, charcoal `#3e4045`,
  light grey `#eff0f2`, link blue `#006ab2`.
- **City chrome** — the charcoal utility strip hanging off the right of the
  brand bar with its leading edge cut on a diagonal, the "City of / Cambridge"
  condensed wordmark beside the seal, the grey nav band closed by a red rule,
  square uppercase buttons that invert on hover, and the charcoal footer.
- **Fonts** — the City sets body copy in `aktiv-grotesk` and display type in
  `alternate-gothic-no-3-d`, both served from Adobe Fonts, plus a custom
  `Cantabrigia` commissioned from Bastarda Type Foundry. **None of the three may
  be redistributed**, so none of them are in this repository. See
  [Fonts and licensing](#fonts-and-licensing) below.

## Fonts and licensing

This is a licensing constraint, not a GitHub Pages constraint. Adobe's Product
Specific Terms prohibit "hosting the Licensed Content on your own server or
other self-hosting option", and the Bastarda EULA permits web embedding but
forbids making the font software available to third parties. Committing any of
them to a public repository is redistribution.

So the site ships two open-licensed stand-ins, self-hosted as subset `woff2`
files in `assets/fonts/` under the SIL Open Font License (see
`assets/fonts/OFL.txt`):

| City font | Substitute here | Used for |
| --- | --- | --- |
| `aktiv-grotesk` | **Public Sans** | body copy, labels, tables |
| `alternate-gothic-no-3-d` | **League Gothic** | masthead, tabs, headings, KPI figures |

They are close enough that the difference is a typographer's observation rather
than a reader's. Both are subset to latin + latin-ext and total about 62 KB.

**Switching on the real City fonts is a one-line change and requires no CSS
edits.** The `--sans` and `--display` custom properties already list the Adobe
family names *first*; they are inert today because no kit is loaded, so browsers
fall through to the bundled fonts. Adding the City's Adobe Fonts kit `<script>`
to `index.html` makes the real faces win automatically.

Two things would need to happen before that switch:

1. The City web team confirms the explorer is authorised to load the City's
   Adobe Fonts kit (the kit is not domain-locked, but that is an operational
   detail, not permission).
2. Someone checks whether the Cantabrigia commission contract grants
   redistribution or web-embedding rights beyond the stock Bastarda EULA.

- **Charts are hand-drawn SVG.** No charting library. They are also real DOM,
  so they print, they scale, and every bar carries a `<title>` for screen
  readers and hover.
- **Accessibility** — skip link, semantic landmarks, visible focus rings,
  `aria-live` status region, table equivalents for charts, tabular numerals,
  and a print stylesheet. Tooltips open on click rather than hover so they work
  with touch and keyboard, dismiss with Escape, and stay on screen near the
  edges. Not yet formally audited against WCAG 2.1 AA.

## Things worth knowing about the data

- **Revenues equal expenditures exactly, every year.** That is the Massachusetts
  balanced-budget requirement, not a bug. The revenue figure is therefore shown
  as "Balanced — revenues equal appropriations" rather than repeating the number.
- **Department and service-area names change between years** — see the section
  above. This is the single most consequential quirk in the dataset, and the one
  most likely to produce a confidently wrong chart.
- **Line-item granularity varies by year.** FY2013 has 3,211 expenditure rows;
  FY2016 has 1,320, despite being a larger budget. Yearly totals are consistent
  and reconcile; only the level of published detail changed. Drill down far
  enough into an older year and you will hit a different floor than in a recent
  one.
- **These are budgeted amounts** — what was adopted, not year-end actuals and
  not individual payments.
- **Live mode reports slightly fewer line items than snapshot mode** (1,602 vs
  1,638 for FY2027) because SoQL `GROUP BY` collapses exactly duplicated rows.
  The totals are identical. Expected, not a defect.

## What this deliberately does not do

There is no self-service upload UI — no screen where someone picks a
spreadsheet, maps arbitrary columns and publishes. That feature exists to serve
organizations with no data infrastructure. Cambridge already publishes
structured, machine-readable budget data on a maintained platform, so the
upload-and-map layer is a step we do not need; the build script reads the
published dataset directly.

There is no internal capital-request workflow — staff submitting funding
requests, admins approving or rejecting them. That is budget *development*, not
budget *transparency*; it needs authentication and database writes, and it does
not belong on a public transparency page.

Nor does this collect questions from the public. Routing resident questions to
the right person in Finance is a workflow problem, not a website problem, and
the existing open data contact channels already do it.

If the Budget Office wants to change what this page shows — new chart, new
grouping, new year — that is a small pull request against one HTML file, not a
production database write through an admin panel. If they want to change the
*words* — a definition, a link, an FAQ answer — that is an edit to a JSON file
in `content/`, done in the browser, no developer involved.

## Status

Proof of concept. **Not an official City of Cambridge page.** No accessibility
audit, no content review, no sign-off from Communications. The figures come
from the City's published data and should tie out, but they have not been
reconciled against the adopted budget document.

