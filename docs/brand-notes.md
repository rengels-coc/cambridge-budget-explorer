# How the Budget Explorer follows the City brand

For review by the Communications Office and the Budget Office.

Everything on the page is styled from the City of Cambridge Brand Guidelines,
*Cambridge Reimagined*, August 2024. This note says what was applied, why, and
the handful of places where the guidelines needed interpretation rather than
literal transcription.

`scripts/brand-check.mjs` re-checks the measurable parts of all of this on
every run, and writes the screenshots in `docs/brand-review/`.

---

## 1. Colour

**Dark Blue `#1D2F8D` leads.** The guidelines assign each function group a
primary colour, and the Budget Office sits in General Government, whose primary
is Dark Blue — the City Official Blue. So the two big flat blocks on the page,
the masthead and the footer, are Dark Blue, and they run to the edges of the
canvas as the design system requires.

**The accent is Bright Orange `#FF6000`.** General Government's approved
complementary families are orange and yellow. Orange appears only as the thin
brand bar: under the tab strip, along the bottom edge of the page, on the top
edge of the headline figure, and as the focus ring.

**Four colour divisions, no more.** Dark Blue (header and footer), white (the
body of the page), Pastel Blue `#CDECFF` (the fiscal-year strip and the summary
rows), and the orange accent bar. That is the maximum the guidelines allow.

**No gradients, no shadows, no rounded corners.** The old build had soft card
shadows and a gradient fade on the scrolling tab strip. Both are gone. Cards are
now defined by a flat 1 px rule; the tab strip's scroll hint is a flat Pastel
Blue edge.

**Every colour on the page is from the published palette.** The brand check
enumerates every rendered colour and fails if anything is not either a palette
entry or one of the approved black tints (10%, 20%, 40%, 60%, 80%). The full
list currently in use:

| Hex | Name | Where |
| --- | --- | --- |
| `#1D2F8D` | Dark Blue | masthead, footer, active tab, headline KPI, totals row |
| `#CDECFF` | Pastel Blue | fiscal-year strip, service-area rows, callouts |
| `#70CBF7` | Light Blue | the "To" column in the year comparison |
| `#196CC6` | Mid Blue | links, lead chart series |
| `#FF6000` | Bright Orange | brand bars, focus ring, second chart series |
| `#016F31` | Mid Green | a figure that went up |
| `#000000` / `#FFFFFF` | Black / White | all text |
| `#E6E6E6` `#CCCCCC` `#666666` | Black 10 / 20 / 60% | table headers, rules, captions |

## 2. Type

| Role | Setting |
| --- | --- |
| Page headline, masthead and footer titles, big dollar figures | Noto Sans at **80%** width, bold |
| Body copy, tables, chart labels | Noto Sans at **100%** width |
| Tabs, panel titles, buttons, links, captions, column labels | Noto Sans at **87.5%** width (Noto Sans Condensed) |

The whole page is one typeface. Noto Sans is variable on both weight and width,
so moving along the width axis produces all three brand roles from a single
60 KB download — and gives the display type a condensed, headline-ish feel
without a second font.

**Cantabrigia, the City's own display face, is deliberately not used.** It was
tried, and it looked good, but it is licensed from Bastarda Type for the City's
own use and cannot be redistributed — which would have blocked publishing this
repository at all. Condensed Noto Sans is the guidelines' own named substitute
for it. Adopting it removes a legal dependency from the critical path, and the
side-by-side comparison was close enough that the constraint was not worth
carrying. Section 6 covers how to put Cantabrigia back if Communications
prefers.

Three things changed to comply:

- **Nothing is in all caps any more.** The guidelines are explicit: headlines
  are sentence case, never all caps. The old build set the masthead, the tabs,
  every panel heading, every table header, every button and every micro-label in
  caps. All of it is now sentence case. The brand check fails if any element
  anywhere renders with `text-transform: uppercase`.
- **Letter-spacing is back to normal.** The guidelines say to avoid extreme
  tracking. The old build spaced micro-labels out to 0.12 em; those now sit at
  the font's default.
- **Body copy is 16 px and black**, which is the web minimum in the guidelines.

## 3. The City mark

The old build used the **City Seal** in the masthead and as the favicon. The
guidelines restrict the seal to official, legal and executive documents —
proclamations, certificates, formal letterhead — and specifically not
dashboards. It has been replaced by the **primary City logo** (white version,
used as supplied, never redrawn or recoloured) on the Dark Blue block.

The rule is one brand element per design, so the favicon is the City Hall icon
from that same logo rather than the separate brandmark.

## 4. Charts

Charts follow the brand-derived categorical sequence, in order, stopping as
early as possible:

```
#196CC6  Mid Blue        (lead)
#FF6000  Bright Orange
#29BA38  Green
#730FE8  Mid Purple
#EC1A88  Mid Magenta
#FFB800  Mid Yellow
#1D2F8D  Dark Blue
#D20404  Mid Red
#999999  Black 40%       (reserved for "Other")
```

Bars are flat, gridlines are `#E6E6E6`, and every bar is directly labelled with
its name, its dollar amount and its share — so colour is never the only thing
carrying meaning, which is both a brand rule and a WCAG one.

## 5. Contrast

Every piece of text on every view is measured against its actual rendered
background and must clear WCAG 2.1 AA: 4.5:1 for normal text, 3:1 for large
text. This is computed, not eyeballed, on the overview, trends, budget detail,
compare, capital and mobile views. It currently passes with nothing to waive.

---

## Two places the guidelines were interpreted

Both are flagged here rather than buried, because they are judgement calls the
Communications Office may want to overrule.

**1. Up and down figures are coloured.** The guidelines say body text is always
black or white. A percentage change reading `−10.8%` in Dark Red `#C20000`, or
`+4.1%` in Mid Green `#016F31`, is coloured text on a white ground. It was kept
because financial tables are read by scanning for direction, both colours are
from the published secondary palette, and both clear AA. The meaning never
depends on the colour alone — every figure carries a `+` or `−` sign and, on
the summary cards, the words "Up" or "Down".

**2. The comparison table tints two whole columns.** Pastel Blue for the "From"
year and Light Blue for the "To" year, so the eye can follow a pair down a long
table. That is arguably a fifth and sixth colour division. It reads as one
device rather than six blocks, and the columns are also labelled `From` and
`To` in text, so the tint is reinforcement rather than the signal.

### A note on the red

Mid Red `#D20404` is reserved for one job: marking the thing you are currently
looking at — the selected year on the trend line, the highlighted year in the
stacked chart, the column you are re-picking. It is deliberately *not* one of
the six colours the service areas get in charts, so red never means a category,
only "you are here". Dark Red `#C20000` is the separate, darker shade used for
a figure that fell.

---

## 6. Nothing here blocks publication

This was a live question during the build, and it is now closed.

The City's own display face, Cantabrigia, cannot be redistributed — the Bastarda
Type licence lets the City embed it in the City's own sites, but committing the
files to a public repository counts as redistribution. Shipping it would have
meant either keeping this repository private or getting a legal opinion before
anything could be published.

**So it is not used.** Every font here is Noto Sans under the SIL Open Font
License. `scripts/brand-check.mjs` enforces that as a release gate: it scans
`assets/fonts/` on every run and fails if anything that is not an OFL Noto Sans
subset appears. Nobody has to remember.

Nothing else in the project is encumbered either. The City logo is the City's own
mark on the City's own site, the budget data is already published as public
domain, and there are no third-party dependencies to audit.

**If Communications would rather have Cantabrigia**, on City-controlled hosting
where redistribution is not in play, it is a two-line change: add the
`@font-face` block and put `"Cantabrigia"` at the front of the `--display` stack
in `assets/css/style.css`. The brand check will confirm whether it actually took
— it asks the renderer which font painted the glyphs, rather than trusting the
declared `font-family`, because a font stack records what was *asked for*, not
what was used. That distinction caught a real error during this work.
