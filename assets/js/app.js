/* Cambridge Budget Explorer
 * Static, dependency-free. Reads a pre-built snapshot from ./data when one is
 * present (generated nightly by GitHub Actions), and otherwise queries the
 * City's Socrata open data API directly from the browser.
 *
 * No framework, no charting library, no build step for the front end.
 */
(function () {
  'use strict';

  var SOCRATA = 'https://data.cambridgema.gov/resource/';
  var DATASETS = {
    expenditures: '5bn4-5wey',
    revenues: 'ixyv-mje6',
    capital: '9chi-2ed3'
  };

  var PALETTE = ['#213a7f', '#2294d6', '#473e81', '#e6730f', '#b98f00', '#1a892b', '#d72524', '#6b6f76'];

  /* Each tab is its own route. `year: true` means the tab is scoped to one
     fiscal year, so the year picker is shown and the year rides in the URL. */
  var TABS = [
    { id: 'overview',  title: 'Overview',            year: true },
    { id: 'trends',    title: 'Trends',              year: false },
    { id: 'detail',    title: 'Budget detail',       year: true },
    { id: 'compare',   title: 'Compare fiscal years', year: false },
    { id: 'revenues',  title: 'Revenues',            year: true },
    { id: 'capital',   title: 'Capital projects',    year: true },
    { id: 'documents', title: 'Documents & resources', year: false },
    { id: 'faq',       title: 'Frequently asked questions', year: false },
    { id: 'about',     title: 'About this data',     year: false }
  ];

  var DEFAULT_TAB = 'overview';

  /* Hashes people may already have bookmarked, from before the page had tabs. */
  var LEGACY_TABS = { spending: 'overview', trend: 'trends', composition: 'trends' };

  var state = {
    mode: 'live',
    tab: DEFAULT_TAB,
    ready: false,
    years: [],
    year: null,
    trend: [],
    composition: null,
    matrix: null,
    glossary: null,
    services: [],
    categories: [],
    departments: [],
    tree: [],
    revenueTree: [],
    revenueCategories: [],
    capital: [],
    revenueByYear: {},
    capitalByYear: {},
    compareYears: [],
    compareOpen: {},
    detailOpen: {},
    detailAllExpanded: false
  };

  /* ---------------- utilities ---------------- */

  var $ = function (id) { return document.getElementById(id); };

  var fmtFull = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0
  });

  function money(n) {
    if (n == null || isNaN(n)) return '—';
    return fmtFull.format(n);
  }

  function moneyShort(n) {
    if (n == null || isNaN(n)) return '—';
    var abs = Math.abs(n);
    var sign = n < 0 ? '−' : '';
    if (abs >= 1e9) return sign + '$' + (abs / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return sign + '$' + Math.round(abs / 1e3) + 'K';
    return sign + '$' + Math.round(abs);
  }

  function pct(part, whole) {
    if (!whole) return '0%';
    return (part / whole * 100).toFixed(1) + '%';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function setStatus(msg, isError) {
    var el = $('status');
    if (!msg) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = msg;
    el.className = 'status' + (isError ? ' status--error' : '');
  }

  /* ------------------------------------------------------------------ *
   * Label normalisation
   *
   * The City renames service areas, departments, categories and funds from
   * time to time, and the open data keeps whatever label was current that
   * year. content/aliases.json folds the historical spellings onto the
   * current one so multi-year views stay continuous. The snapshot build
   * applies the same file server-side; this is the live-mode equivalent.
   * ------------------------------------------------------------------ */

  var ALIASES = null;

  var ALIAS_FIELDS = [
    ['service', 'service'],
    ['department_name', 'department_name'],
    ['department', 'department_name'],
    ['category', 'category'],
    ['fund', 'fund']
  ];

  function loadAliases() {
    return json('content/aliases.json', true).then(function (raw) {
      if (!raw) { ALIASES = {}; return; }
      var out = {};
      ['service', 'department_name', 'category', 'fund'].forEach(function (f) {
        var m = raw[f];
        if (!m) return;
        var clean = {};
        Object.keys(m).forEach(function (k) {
          if (k.charAt(0) !== '_' && typeof m[k] === 'string') clean[k] = m[k];
        });
        out[f] = clean;
      });
      ALIASES = out;
    }).catch(function () { ALIASES = {}; });
  }

  function applyAliases(rows) {
    if (!ALIASES || !rows || !rows.length) return rows;
    rows.forEach(function (r) {
      ALIAS_FIELDS.forEach(function (pair) {
        var map = ALIASES[pair[1]];
        if (!map || r[pair[0]] == null) return;
        var to = map[String(r[pair[0]]).trim()];
        if (to) r[pair[0]] = to;
      });
    });
    return rows;
  }

  function soql(dataset, params) {
    var qs = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    return fetch(SOCRATA + dataset + '.json?' + qs).then(function (r) {
      if (!r.ok) throw new Error('Socrata returned HTTP ' + r.status);
      return r.json();
    }).then(applyAliases);
  }

  function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }

  function download(text, filename, mime) {
    var blob = new Blob([text], { type: (mime || 'text/csv') + ';charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function csvCell(s) {
    s = String(s == null ? '' : s);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /* ---------------- glossary tooltips ---------------- */

  /* Look a term up across every glossary section. */
  function defineTerm(term, section) {
    var g = state.glossary;
    if (!g) return null;
    if (section && g[section] && g[section][term]) return g[section][term];
    var sections = ['categories', 'services', 'funds', 'revenueCategories', 'concepts'];
    for (var i = 0; i < sections.length; i++) {
      var s = g[sections[i]];
      if (s && s[term]) return s[term];
    }
    return null;
  }

  /* Returns markup for an accessible tooltip trigger, or '' when undefined. */
  function tip(term, section) {
    var text = defineTerm(term, section);
    if (!text) return '';
    return '<button type="button" class="tip" aria-label="What does &quot;' + esc(term) +
      '&quot; mean?" data-tip="' + esc(text) + '"><span aria-hidden="true">?</span></button>';
  }

  var activeTip = null;

  function closeTip() {
    if (activeTip) { activeTip.remove(); activeTip = null; }
  }

  function openTip(btn) {
    closeTip();
    var bubble = document.createElement('div');
    bubble.className = 'tip-bubble';
    bubble.setAttribute('role', 'tooltip');
    bubble.textContent = btn.getAttribute('data-tip');
    document.body.appendChild(bubble);

    var r = btn.getBoundingClientRect();
    var top = r.bottom + window.scrollY + 8;
    var left = r.left + window.scrollX - bubble.offsetWidth / 2 + r.width / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - bubble.offsetWidth - 12));

    // Flip above the trigger if it would run off the bottom of the viewport.
    if (r.bottom + bubble.offsetHeight + 16 > window.innerHeight) {
      top = r.top + window.scrollY - bubble.offsetHeight - 8;
    }
    bubble.style.top = top + 'px';
    bubble.style.left = left + 'px';
    activeTip = bubble;
  }

  function wireTooltips() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.tip') : null;
      if (btn) {
        e.preventDefault();
        if (activeTip && activeTip._owner === btn) { closeTip(); return; }
        openTip(btn);
        if (activeTip) activeTip._owner = btn;
        return;
      }
      if (!e.target.closest || !e.target.closest('.tip-bubble')) closeTip();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeTip(); });
    window.addEventListener('resize', closeTip);
  }

  /* Fill in the static tooltip placeholders declared in the HTML. */
  function renderConceptTips() {
    document.querySelectorAll('[data-tip-concept]').forEach(function (el) {
      el.innerHTML = tip(el.getAttribute('data-tip-concept'), 'concepts');
    });
  }

  /* ---------------- SVG chart helpers ---------------- */

  function svgOpen(w, h, label) {
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(label) +
      '" preserveAspectRatio="xMinYMin meet">';
  }

  /* Horizontal bar chart. Every panel is full width now that each section has
     its own tab, so there is a single coordinate space: 800 units wide, which
     keeps the label type at a consistent size no matter how few rows there are. */
  function barChart(container, rows, opts) {
    opts = opts || {};
    var total = rows.reduce(function (s, r) { return s + r.value; }, 0);
    var max = rows.reduce(function (m, r) { return Math.max(m, r.value); }, 0) || 1;

    var rowH = 46;
    var padTop = 8;
    var w = 800;
    var h = padTop + rows.length * rowH + 8;
    var fmtVal = money;

    var parts = [svgOpen(w, h, opts.title || 'Bar chart')];

    rows.forEach(function (r, i) {
      var y = padTop + i * rowH;
      var fillW = Math.max(2, (r.value / max) * w);
      var color = r.color || PALETTE[i % PALETTE.length];
      parts.push('<g class="bar-row">');
      parts.push('<text class="bar-row__label" x="0" y="' + (y + 12) + '">' + esc(r.label) + '</text>');
      parts.push('<text class="bar-row__value" x="' + w + '" y="' + (y + 12) + '" text-anchor="end">' +
        esc(fmtVal(r.value)) + '</text>');
      parts.push('<rect class="bar-row__track" x="0" y="' + (y + 20) + '" width="' + w + '" height="12" rx="3"/>');
      parts.push('<rect class="bar-row__fill" x="0" y="' + (y + 20) + '" width="' + fillW +
        '" height="12" rx="3" fill="' + color + '"><title>' + esc(r.label) + ': ' + esc(money(r.value)) +
        ' (' + pct(r.value, total) + ')</title></rect>');
      var px = fillW + 8, anchor = 'start', cls = 'bar-row__pct';
      if (px > w - 40) { px = fillW - 8; anchor = 'end'; cls += ' bar-row__pct--inside'; }
      parts.push('<text class="' + cls + '" x="' + px + '" y="' + (y + 30) + '" text-anchor="' + anchor +
        '">' + pct(r.value, total) + '</text>');
      parts.push('</g>');
    });

    parts.push('</svg>');
    container.innerHTML = parts.join('');
  }

  /* Line chart over fiscal years. */
  function trendChart(container, points, activeYear) {
    if (!points.length) { container.innerHTML = '<p class="empty">No data.</p>'; return; }

    var w = 460, h = 250;
    var m = { top: 22, right: 14, bottom: 30, left: 54 };
    var iw = w - m.left - m.right, ih = h - m.top - m.bottom;

    var maxV = Math.max.apply(null, points.map(function (p) { return p.value; }));
    var niceMax = Math.ceil(maxV / 1e8) * 1e8 || 1;

    var x = function (i) { return m.left + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw); };
    var y = function (v) { return m.top + ih - (v / niceMax) * ih; };

    var parts = [svgOpen(w, h, 'Adopted operating budget by fiscal year')];

    for (var t = 0; t <= 4; t++) {
      var tv = (niceMax / 4) * t, ty = y(tv);
      parts.push('<line class="grid-line" x1="' + m.left + '" y1="' + ty + '" x2="' + (w - m.right) + '" y2="' + ty + '"/>');
      parts.push('<text class="axis-text" x="' + (m.left - 8) + '" y="' + (ty + 4) + '" text-anchor="end">' +
        moneyShort(tv) + '</text>');
    }

    var area = points.map(function (p, i) { return (i ? 'L' : 'M') + x(i) + ' ' + y(p.value); }).join(' ') +
      ' L' + x(points.length - 1) + ' ' + y(0) + ' L' + x(0) + ' ' + y(0) + ' Z';
    parts.push('<path class="trend-area" d="' + area + '"/>');
    parts.push('<path class="trend-line" d="' +
      points.map(function (p, i) { return (i ? 'L' : 'M') + x(i) + ' ' + y(p.value); }).join(' ') + '"/>');

    points.forEach(function (p, i) {
      var active = String(p.year) === String(activeYear);
      parts.push('<circle class="trend-dot' + (active ? ' trend-dot--active' : '') + '" cx="' + x(i) +
        '" cy="' + y(p.value) + '" r="' + (active ? 6 : 3.5) + '"><title>FY' + esc(p.year) + ': ' +
        esc(money(p.value)) + '</title></circle>');
      if (active) {
        var lx = Math.min(Math.max(x(i), m.left + 30), w - m.right - 30);
        parts.push('<text class="trend-label" x="' + lx + '" y="' + (y(p.value) - 13) +
          '" text-anchor="middle">' + moneyShort(p.value) + '</text>');
      }
      if (i % 2 === 0 || i === points.length - 1) {
        parts.push('<text class="axis-text" x="' + x(i) + '" y="' + (h - 10) + '" text-anchor="middle">FY' +
          String(p.year).slice(-2) + '</text>');
      }
    });

    parts.push('<line class="axis-line" x1="' + m.left + '" y1="' + y(0) + '" x2="' + (w - m.right) +
      '" y2="' + y(0) + '"/>');
    parts.push('</svg>');
    container.innerHTML = parts.join('');
  }

  /* Stacked columns: service-area composition across every fiscal year. */
  function stackedChart(container, comp, activeYear) {
    if (!comp || !comp.years.length) { container.innerHTML = '<p class="empty">No data.</p>'; return; }

    var years = comp.years, series = comp.series;
    var w = 900, h = 340;
    var m = { top: 16, right: 14, bottom: 34, left: 62 };
    var iw = w - m.left - m.right, ih = h - m.top - m.bottom;

    var totals = years.map(function (_, i) {
      return series.reduce(function (s, ser) { return s + (ser.data[i] || 0); }, 0);
    });
    var maxV = Math.max.apply(null, totals);
    var niceMax = Math.ceil(maxV / 1e8) * 1e8 || 1;

    var band = iw / years.length;
    var barW = Math.min(38, band * 0.62);
    var cx = function (i) { return m.left + band * i + band / 2; };
    var y = function (v) { return m.top + ih - (v / niceMax) * ih; };

    var parts = [svgOpen(w, h, 'Operating budget composition by service area, every fiscal year')];

    for (var t = 0; t <= 4; t++) {
      var tv = (niceMax / 4) * t, ty = y(tv);
      parts.push('<line class="grid-line" x1="' + m.left + '" y1="' + ty + '" x2="' + (w - m.right) + '" y2="' + ty + '"/>');
      parts.push('<text class="axis-text" x="' + (m.left - 8) + '" y="' + (ty + 4) + '" text-anchor="end">' +
        moneyShort(tv) + '</text>');
    }

    years.forEach(function (yr, i) {
      var acc = 0;
      var isActive = String(yr) === String(activeYear);
      series.forEach(function (ser, si) {
        var v = ser.data[i] || 0;
        if (!v) return;
        var y1 = y(acc + v), y2 = y(acc);
        acc += v;
        parts.push('<rect class="stack-seg" x="' + (cx(i) - barW / 2) + '" y="' + y1 + '" width="' + barW +
          '" height="' + Math.max(0.5, y2 - y1) + '" fill="' + PALETTE[si % PALETTE.length] + '">' +
          '<title>FY' + esc(yr) + ' · ' + esc(ser.label) + ': ' + esc(money(v)) + ' (' +
          pct(v, totals[i]) + ' of that year)</title></rect>');
      });
      if (isActive) {
        parts.push('<rect class="stack-active" x="' + (cx(i) - barW / 2 - 3) + '" y="' + (y(acc) - 3) +
          '" width="' + (barW + 6) + '" height="' + (y(0) - y(acc) + 6) + '" rx="3"/>');
      }
      if (i % 2 === 0 || i === years.length - 1) {
        parts.push('<text class="axis-text' + (isActive ? ' axis-text--active' : '') + '" x="' + cx(i) +
          '" y="' + (h - 12) + '" text-anchor="middle">FY' + String(yr).slice(-2) + '</text>');
      }
    });

    parts.push('<line class="axis-line" x1="' + m.left + '" y1="' + y(0) + '" x2="' + (w - m.right) +
      '" y2="' + y(0) + '"/>');
    parts.push('</svg>');
    container.innerHTML = parts.join('');

    $('composition-legend').innerHTML = series.map(function (s, i) {
      return '<span class="legend__item"><span class="swatch" style="background:' +
        PALETTE[i % PALETTE.length] + '"></span>' + esc(s.label) + tip(s.label, 'services') + '</span>';
    }).join('');
  }

  /* ---------------- drill-down tree ---------------- */

  var TREE_LEVELS = ['Service area', 'Department', 'Division', 'Category', 'Line item'];

  /* Filter a tree to nodes matching `q`, keeping ancestors of any match. */
  function filterTree(nodes, q) {
    var out = [];
    nodes.forEach(function (nd) {
      var self = nd.name.toLowerCase().indexOf(q) !== -1;
      var kids = nd.kids ? filterTree(nd.kids, q) : null;
      if (self) {
        out.push(nd);
      } else if (kids && kids.length) {
        out.push({ name: nd.name, total: nd.total, kids: kids });
      }
    });
    return out;
  }

  function countLeaves(nodes) {
    return nodes.reduce(function (s, nd) {
      return s + (nd.kids && nd.kids.length ? countLeaves(nd.kids) : 1);
    }, 0);
  }

  /* No definition tooltips in the drill-down trees. The glossary text is still
     draft and unreviewed, and the same helper renders the revenue tree, where
     the depth-based lookup would have matched revenue sources against service
     area definitions. Tooltips stay on the comparison table and the chart
     legends, where the labels are service areas and the mapping is right. */
  function renderTreeNodes(nodes, grand, path, depth, openMap, forceOpen, out) {
    nodes.forEach(function (nd) {
      var key = path + '|' + nd.name;
      var hasKids = !!(nd.kids && nd.kids.length);
      var open = forceOpen || !!openMap[key];

      out.push('<div class="tree-row tree-row--d' + depth + (hasKids ? '' : ' tree-row--leaf') + '"' +
        ' style="--depth:' + depth + '">');

      // The name sits in its own grid cell. Keeping the row to exactly three
      // children is what stops the amount wrapping onto a second line.
      out.push('<span class="tree-label">');
      if (hasKids) {
        out.push('<button class="tree-toggle" type="button" data-tree-key="' + esc(key) +
          '" aria-expanded="' + open + '">' +
          '<span class="tree-caret' + (open ? ' tree-caret--open' : '') + '" aria-hidden="true"></span>' +
          '<span class="tree-name">' + esc(nd.name) + '</span></button>');
      } else {
        out.push('<span class="tree-name tree-name--leaf">' + esc(nd.name) + '</span>');
      }
      out.push('</span>');

      out.push('<span class="tree-share">' + pct(nd.total, grand) + '</span>');
      out.push('<span class="tree-amount">' + esc(money(nd.total)) + '</span>');
      out.push('</div>');

      if (hasKids && open) {
        renderTreeNodes(nd.kids, grand, key, depth + 1, openMap, forceOpen, out);
      }
    });
  }

  function renderDetail() {
    var q = $('detail-search').value.trim().toLowerCase();
    var nodes = q ? filterTree(state.tree, q) : state.tree;
    var grand = state.tree.reduce(function (s, nd) { return s + nd.total; }, 0);
    var el = $('detail-tree');

    if (!nodes.length) {
      el.innerHTML = '<p class="empty">Nothing matches &ldquo;' + esc(q) + '&rdquo;.</p>';
      $('detail-sub').textContent = 'No matching line items in FY' + state.year + '.';
      return;
    }

    // A search implies you want to see what matched, so force the branches open.
    var forceOpen = !!q || state.detailAllExpanded;
    var out = ['<div class="tree-head"><span class="tree-head__name">' +
      TREE_LEVELS.join(' <span aria-hidden="true">&rsaquo;</span> ') +
      '</span><span class="tree-head__share">Share</span><span class="tree-head__amount">Amount</span></div>'];
    renderTreeNodes(nodes, grand, '', 0, state.detailOpen, forceOpen, out);
    el.innerHTML = out.join('');

    var leaves = countLeaves(nodes);
    $('detail-sub').textContent = q
      ? leaves.toLocaleString() + ' matching line items in FY' + state.year
      : state.lineItemCount
        ? state.lineItemCount.toLocaleString() + ' line items across ' +
          state.departments.length + ' departments, FY' + state.year
        : leaves.toLocaleString() + ' line items, FY' + state.year;
  }

  function flattenTree(nodes, prefix, rows) {
    nodes.forEach(function (nd) {
      var path = prefix.concat([nd.name]);
      if (nd.kids && nd.kids.length) {
        flattenTree(nd.kids, path, rows);
      } else {
        rows.push({ path: path, total: nd.total });
      }
    });
    return rows;
  }

  function exportDetail() {
    var q = $('detail-search').value.trim().toLowerCase();
    var nodes = q ? filterTree(state.tree, q) : state.tree;
    var rows = flattenTree(nodes, [], []);
    var lines = [['Fiscal Year'].concat(TREE_LEVELS, ['Budgeted Amount']).join(',')];
    rows.forEach(function (r) {
      var p = r.path.slice();
      while (p.length < TREE_LEVELS.length) p.push('');
      lines.push([state.year].concat(p.map(csvCell), [r.total]).join(','));
    });
    download(lines.join('\n'), 'cambridge-budget-detail-FY' + state.year + (q ? '-filtered' : '') + '.csv');
  }

  /* ---------------- multi-year comparison ---------------- */

  function pickYears(kind) {
    var ys = state.years;
    if (kind === 'all') return ys.slice();
    if (kind === 'recent3') return ys.slice(-3);
    if (kind === 'recent5') return ys.slice(-5);
    if (kind === 'decade') {
      var out = [];
      for (var i = ys.length - 1; i >= 0; i -= 5) out.unshift(ys[i]);
      return out;
    }
    return ys.slice(-3);
  }

  function renderYearPicker() {
    $('compare-years').innerHTML = state.years.map(function (y) {
      var on = state.compareYears.indexOf(y) !== -1;
      return '<label class="yearpick__item"><input type="checkbox" value="' + y + '"' +
        (on ? ' checked' : '') + '> FY' + y + '</label>';
    }).join('');
  }

  function renderCompareRows(nodes, sel, path, depth, out, q) {
    nodes.forEach(function (nd) {
      var key = path + '|' + nd.name;
      var hasKids = !!(nd.kids && nd.kids.length);
      var open = !!q || !!state.compareOpen[key];

      var cells = sel.map(function (y) {
        var v = nd.byYear[y];
        return '<td class="num">' + (v ? esc(money(v)) : '<span class="dash">—</span>') + '</td>';
      });

      // Percent change always compares the two most recent SELECTED years, so
      // the column matches what the reader can actually see.
      var chg = '<span class="dash">—</span>';
      if (sel.length >= 2) {
        var a = nd.byYear[sel[sel.length - 2]], b = nd.byYear[sel[sel.length - 1]];
        if (a && b) {
          var d = (b - a) / a * 100;
          chg = '<span class="' + (d >= 0 ? 'chg chg--up' : 'chg chg--down') + '">' +
            (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(1) + '%</span>';
        } else if (!a && b) {
          chg = '<span class="chg chg--new">new</span>';
        } else if (a && !b) {
          chg = '<span class="chg chg--down">ended</span>';
        }
      }

      out.push('<tr class="cmp-d' + depth + '">');
      out.push('<th scope="row" style="--depth:' + depth + '"><span class="tree-label">');
      if (hasKids) {
        out.push('<button class="tree-toggle" type="button" data-cmp-key="' + esc(key) +
          '" aria-expanded="' + open + '">' +
          '<span class="tree-caret' + (open ? ' tree-caret--open' : '') + '" aria-hidden="true"></span>' +
          '<span class="tree-name">' + esc(nd.name) + '</span></button>');
      } else {
        out.push('<span class="tree-name tree-name--leaf">' + esc(nd.name) + '</span>');
      }
      if (depth === 0) out.push(tip(nd.name, 'services') || tip(nd.name, 'revenueCategories'));
      out.push('</span></th>');
      out.push(cells.join(''));
      out.push('<td class="num">' + chg + '</td>');
      out.push('</tr>');

      if (hasKids && open) renderCompareRows(nd.kids, sel, key, depth + 1, out, q);
    });
  }

  function compareSource() {
    return state.matrix ? state.matrix.expenses : [];
  }

  function renderCompare() {
    var el = $('compare-table');
    if (!state.matrix) {
      el.innerHTML = '<p class="empty">Year-over-year comparison could not be loaded. ' +
        'Reload the page, or run <code>node scripts/build-data.mjs</code> to build a local snapshot.</p>';
      $('compare-sub').textContent = 'Unavailable.';
      return;
    }

    var sel = state.compareYears.slice().sort();
    if (!sel.length) {
      el.innerHTML = '<p class="empty">Select at least one fiscal year.</p>';
      return;
    }

    var q = $('compare-search').value.trim().toLowerCase();
    var nodes = compareSource();
    if (q) nodes = filterMatrix(nodes, q);

    if (!nodes.length) {
      el.innerHTML = '<p class="empty">Nothing matches &ldquo;' + esc(q) + '&rdquo;.</p>';
      return;
    }

    var head = ['<table class="cmp"><caption>Budgeted operating spending by service area, ' +
      'department and division. Percent change compares FY' + sel[Math.max(0, sel.length - 2)] +
      ' to FY' + sel[sel.length - 1] + '.</caption><thead><tr><th scope="col">Service area / department / division</th>'];
    sel.forEach(function (y) { head.push('<th scope="col" class="num">FY' + y + '</th>'); });
    head.push('<th scope="col" class="num">% change</th></tr></thead><tbody>');

    var out = [];
    renderCompareRows(nodes, sel, '', 0, out, q);

    // Total row, summed from the top level so it always ties to the year total.
    var totals = sel.map(function (y) {
      return nodes.reduce(function (s, nd) { return s + (nd.byYear[y] || 0); }, 0);
    });
    var tchg = '<span class="dash">—</span>';
    if (sel.length >= 2 && totals[totals.length - 2]) {
      var d = (totals[totals.length - 1] - totals[totals.length - 2]) / totals[totals.length - 2] * 100;
      tchg = '<span class="' + (d >= 0 ? 'chg chg--up' : 'chg chg--down') + '">' +
        (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(1) + '%</span>';
    }
    var foot = ['</tbody><tfoot><tr><th scope="row">' + (q ? 'Total (filtered)' : 'Total') + '</th>'];
    totals.forEach(function (t) { foot.push('<td class="num">' + esc(money(t)) + '</td>'); });
    foot.push('<td class="num">' + tchg + '</td></tr></tfoot></table>');

    el.innerHTML = head.join('') + out.join('') + foot.join('');
    $('compare-sub').textContent = sel.length + ' fiscal year' + (sel.length === 1 ? '' : 's') +
      ' shown' + (q ? ', filtered by “' + q + '”' : '') + '. Select a row to expand it.';
  }

  function filterMatrix(nodes, q) {
    var out = [];
    nodes.forEach(function (nd) {
      var self = nd.name.toLowerCase().indexOf(q) !== -1;
      var kids = nd.kids ? filterMatrix(nd.kids, q) : null;
      if (self) out.push(nd);
      else if (kids && kids.length) out.push({ name: nd.name, byYear: nd.byYear, kids: kids });
    });
    return out;
  }

  function exportCompare() {
    if (!state.matrix) return;
    var sel = state.compareYears.slice().sort();
    var q = $('compare-search').value.trim().toLowerCase();
    var nodes = q ? filterMatrix(compareSource(), q) : compareSource();

    var lines = [['Service Area', 'Department', 'Division'].concat(
      sel.map(function (y) { return 'FY' + y; })).join(',')];

    (function walk(ns, path) {
      ns.forEach(function (nd) {
        var p = path.concat([nd.name]);
        if (nd.kids && nd.kids.length) {
          walk(nd.kids, p);
        } else {
          var padded = p.slice();
          while (padded.length < 3) padded.push('');
          lines.push(padded.map(csvCell).concat(
            sel.map(function (y) { return nd.byYear[y] || 0; })).join(','));
        }
      });
    })(nodes, []);

    download(lines.join('\n'), 'cambridge-budget-comparison.csv');
  }

  /* ---------------- other tables ---------------- */

  function serviceTable(rows) {
    var total = rows.reduce(function (s, r) { return s + r.value; }, 0);
    var html = ['<table><caption>Spending by service area, FY' + esc(state.year) +
      '</caption><thead><tr><th scope="col">Service area</th><th scope="col" class="num">Amount</th>' +
      '<th scope="col" class="num">Share</th></tr></thead><tbody>'];
    rows.forEach(function (r, i) {
      html.push('<tr><td><span class="swatch" style="background:' + (r.color || PALETTE[i % PALETTE.length]) +
        '"></span>' + esc(r.label) + tip(r.label, 'services') + '</td><td class="num">' +
        esc(money(r.value)) + '</td><td class="num">' + pct(r.value, total) + '</td></tr>');
    });
    html.push('</tbody></table>');
    return html.join('');
  }

  function compositionTable(comp) {
    if (!comp) return '<p class="empty">Composition data could not be loaded.</p>';
    var html = ['<table><caption>Operating budget by service area and fiscal year</caption>' +
      '<thead><tr><th scope="col">Fiscal year</th>'];
    comp.series.forEach(function (s) { html.push('<th scope="col" class="num">' + esc(s.label) + '</th>'); });
    html.push('<th scope="col" class="num">Total</th></tr></thead><tbody>');
    comp.years.forEach(function (y, i) {
      var tot = comp.series.reduce(function (s, ser) { return s + (ser.data[i] || 0); }, 0);
      html.push('<tr><th scope="row">FY' + esc(y) + '</th>');
      comp.series.forEach(function (ser) {
        html.push('<td class="num">' + esc(moneyShort(ser.data[i] || 0)) + '</td>');
      });
      html.push('<td class="num">' + esc(moneyShort(tot)) + '</td></tr>');
    });
    html.push('</tbody></table>');
    return html.join('');
  }

  function renderRevenues() {
    var cats = state.revenueCategories;
    var el = $('revenue-chart');
    if (!cats.length) {
      el.innerHTML = '<p class="empty">No revenue detail published for FY' + esc(state.year) + '.</p>';
      $('revenue-sub').textContent = '';
      $('revenue-detail').innerHTML = '';
      return;
    }
    var total = cats.reduce(function (s, r) { return s + r.value; }, 0);
    barChart(el, cats.map(function (r, i) {
      return { label: r.label, value: r.value, color: PALETTE[i % PALETTE.length] };
    }), { title: 'Budgeted revenue by source' });

    // Re-label the bars with revenue definitions rather than expense ones.
    $('revenue-sub').textContent = cats.length + ' revenue sources · ' + money(total) + ' · FY' + state.year;

    var out = ['<div class="tree-head"><span class="tree-head__name">Source ' +
      '<span aria-hidden="true">&rsaquo;</span> Department <span aria-hidden="true">&rsaquo;</span> Detail</span>' +
      '<span class="tree-head__share">Share</span><span class="tree-head__amount">Amount</span></div>'];
    renderTreeNodes(state.revenueTree, total, 'rev', 0, state.detailOpen, false, out);
    $('revenue-detail').innerHTML = out.join('');
  }

  function renderCapital() {
    var el = $('capital-table');
    var rows = state.capital;
    if (!rows.length) {
      el.innerHTML = '<p class="empty">No capital projects recorded for FY' + esc(state.year) + '.</p>';
      return;
    }
    var total = rows.reduce(function (s, r) { return s + r.amount; }, 0);
    var html = ['<table><caption>Top ' + rows.length + ' capital projects by approved amount, FY' +
      esc(state.year) + '</caption><thead><tr><th scope="col">Project</th>' +
      '<th scope="col">Department</th><th scope="col">Fund</th>' +
      '<th scope="col" class="num">Approved</th></tr></thead><tbody>'];
    rows.forEach(function (r) {
      html.push('<tr><td>' + esc(r.project) + '</td><td>' + esc(r.department) + '</td><td>' +
        esc(r.fund) + tip(r.fund, 'funds') + '</td><td class="num">' + esc(money(r.amount)) + '</td></tr>');
    });
    html.push('</tbody><tfoot><tr><th scope="row" colspan="3">Shown above</th><td class="num">' +
      esc(money(total)) + '</td></tr></tfoot></table>');
    el.innerHTML = html.join('');
  }

  function exportCapital() {
    var lines = [['Fiscal Year', 'Project', 'Department', 'Fund', 'Approved Amount'].join(',')];
    state.capital.forEach(function (r) {
      lines.push([state.year, csvCell(r.project), csvCell(r.department), csvCell(r.fund), r.amount].join(','));
    });
    download(lines.join('\n'), 'cambridge-capital-projects-FY' + state.year + '.csv');
  }

  /* ---------------- content-driven sections ---------------- */

  function renderDocuments(doc) {
    var el = $('documents-body');
    if (!doc || !doc.categories) { el.innerHTML = '<p class="empty">No documents configured.</p>'; return; }
    el.innerHTML = '<div class="doc-grid">' + doc.categories.map(function (c) {
      return '<section class="doc-cat"><h3>' + esc(c.label) + '</h3>' +
        (c.blurb ? '<p class="doc-cat__blurb">' + esc(c.blurb) + '</p>' : '') +
        '<ul class="doc-list">' + c.items.map(function (it) {
          var external = /^https?:/.test(it.url);
          return '<li><a href="' + esc(it.url) + '"' +
            (external ? ' rel="noopener"' : '') + '>' + esc(it.title) + '</a>' +
            (it.note ? '<span class="doc-list__note">' + esc(it.note) + '</span>' : '') + '</li>';
        }).join('') + '</ul></section>';
    }).join('') + '</div>';
  }

  /* FAQ answers are authored HTML from a trusted content file, not user input.
     Tags are limited to a small formatting set. */
  function renderFaq(data) {
    var el = $('faq-body');
    if (!data || !data.faqs) { el.innerHTML = '<p class="empty">No questions configured.</p>'; return; }
    el.innerHTML = '<div class="faq-list">' + data.faqs.map(function (f, i) {
      return '<details class="faq"' + (i === 0 ? ' open' : '') + '>' +
        '<summary>' + esc(f.q) + '</summary>' +
        '<div class="faq__a">' + f.a + '</div></details>';
    }).join('') + '</div>';
  }

  /* ---------------- data loading ---------------- */

  function json(url, optional) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) {
        if (optional) return null;
        throw new Error(url + ' returned HTTP ' + r.status);
      }
      return r.json();
    }).catch(function (e) {
      if (optional) return null;
      throw e;
    });
  }

  function loadTrend() {
    if (state.mode === 'snapshot') return json('data/trend.json');
    return soql(DATASETS.expenditures, {
      '$select': 'fiscal_year,sum(amount) as total',
      '$group': 'fiscal_year',
      '$order': 'fiscal_year'
    }).then(function (rows) {
      return rows.map(function (r) { return { year: String(r.fiscal_year), value: num(r.total) }; });
    });
  }

  /* Live equivalents of the pre-built composition.json and matrix.json, so the
     page is fully functional even with no snapshot on disk. */

  function loadCompositionLive(years) {
    return soql(DATASETS.expenditures, {
      '$select': 'fiscal_year,service,sum(amount) as total',
      '$group': 'fiscal_year,service',
      '$limit': '5000'
    }).then(function (rows) {
      var byService = new Map();
      rows.forEach(function (r) {
        var svc = (r.service || 'Unspecified').trim() || 'Unspecified';
        if (!byService.has(svc)) byService.set(svc, {});
        byService.get(svc)[String(r.fiscal_year)] = num(r.total);
      });
      var newest = years[years.length - 1];
      var labels = [...byService.keys()].sort(function (a, b) {
        return (byService.get(b)[newest] || 0) - (byService.get(a)[newest] || 0);
      });
      return {
        years: years,
        series: labels.map(function (svc) {
          return {
            label: svc,
            data: years.map(function (y) { return byService.get(svc)[y] || 0; })
          };
        })
      };
    });
  }

  function loadMatrixLive(years) {
    return soql(DATASETS.expenditures, {
      '$select': 'fiscal_year,service,department_name,division_name,sum(amount) as total',
      '$group': 'fiscal_year,service,department_name,division_name',
      '$limit': '50000'
    }).then(function (rows) {
      return {
        years: years,
        expenses: matrixFrom(rows, ['service', 'department_name', 'division_name'], years)
      };
    });
  }

  /* Fold flat grouped rows into the nested {name, byYear, kids} shape the
     comparison table expects — the same structure build-data.mjs emits. */
  function matrixFrom(rows, fields, years) {
    var newest = years[years.length - 1];
    var root = new Map();

    rows.forEach(function (r) {
      var fy = String(r.fiscal_year);
      var v = num(r.total);
      var level = root;
      fields.forEach(function (f) {
        var k = (r[f] || 'Unspecified').trim() || 'Unspecified';
        if (!level.has(k)) level.set(k, { name: k, byYear: {}, kids: new Map() });
        var nd = level.get(k);
        nd.byYear[fy] = (nd.byYear[fy] || 0) + v;
        level = nd.kids;
      });
    });

    var toArr = function (m, d) {
      return [...m.values()]
        .sort(function (a, b) { return (b.byYear[newest] || 0) - (a.byYear[newest] || 0); })
        .map(function (x) {
          var o = { name: x.name, byYear: x.byYear };
          if (x.kids.size && d < fields.length - 1) o.kids = toArr(x.kids, d + 1);
          return o;
        });
    };
    return toArr(root, 0);
  }

  function applyYearPayload(fy, p) {
    state.services = p.services.map(function (r, i) {
      return { label: r.label, value: r.value, color: PALETTE[i % PALETTE.length] };
    });
    state.categories = p.categories.map(function (r, i) {
      return { label: r.label, value: r.value, color: PALETTE[i % PALETTE.length] };
    });
    state.departments = p.departments.slice();
    state.tree = p.tree || [];
    state.revenueTree = p.revenueTree || [];
    state.revenueCategories = p.revenueCategories || [];
    state.revenueByYear[fy] = p.revenue;
    state.capitalByYear[fy] = p.capital;
    state.lineItemCount = p.lineItemCount || 0;
    state.capital = (p.capitalProjects || []).map(function (r) {
      return {
        project: r.project, department: r.department || '—',
        fund: r.fund || '—', amount: r.amount
      };
    });
  }

  function loadYear(fy) {
    if (state.mode === 'snapshot') {
      return json('data/fy-' + fy + '.json').then(function (p) { applyYearPayload(fy, p); });
    }
    return loadYearLive(fy);
  }

  /* Live mode: rebuild the same shapes from SoQL, including the detail tree. */
  function loadYearLive(fy) {
    var where = 'fiscal_year=' + fy;

    return Promise.all([
      soql(DATASETS.expenditures, {
        '$select': 'service,department_name,division_name,category,description,sum(amount) as total',
        '$where': where,
        '$group': 'service,department_name,division_name,category,description',
        '$limit': '50000'
      }),
      soql(DATASETS.revenues, {
        '$select': 'category,department_name,description,sum(amount) as total',
        '$where': where,
        '$group': 'category,department_name,description',
        '$limit': '50000'
      }),
      soql(DATASETS.capital, {
        '$select': 'project_name,department,fund,approved_amount',
        '$where': where + ' AND approved_amount > 0',
        '$order': 'approved_amount DESC', '$limit': '25'
      }),
      soql(DATASETS.capital, { '$select': 'sum(approved_amount) as total', '$where': where })
    ]).then(function (res) {
      var expRows = res[0].map(function (r) { return { r: r, v: num(r.total) }; });
      var revRows = res[1].map(function (r) { return { r: r, v: num(r.total) }; });

      var sum = function (rows, field) {
        var m = new Map();
        rows.forEach(function (x) {
          var k = (x.r[field] || 'Unspecified').trim() || 'Unspecified';
          m.set(k, (m.get(k) || 0) + x.v);
        });
        return [...m.entries()].map(function (e) { return { label: e[0], value: e[1] }; })
          .sort(function (a, b) { return b.value - a.value; });
      };

      var tree = function (rows, fields) {
        var root = new Map();
        rows.forEach(function (x) {
          var level = root;
          fields.forEach(function (f) {
            var k = (x.r[f] || 'Unspecified').trim() || 'Unspecified';
            if (!level.has(k)) level.set(k, { name: k, total: 0, kids: new Map() });
            var nd = level.get(k);
            nd.total += x.v;
            level = nd.kids;
          });
        });
        var toArr = function (m, d) {
          return [...m.values()].sort(function (a, b) { return b.total - a.total; })
            .map(function (x) {
              var o = { name: x.name, total: x.total };
              if (x.kids.size && d < fields.length - 1) o.kids = toArr(x.kids, d + 1);
              return o;
            });
        };
        return toArr(root, 0);
      };

      var deptMap = new Map();
      expRows.forEach(function (x) {
        var d = (x.r.department_name || 'Unspecified').trim() || 'Unspecified';
        if (!deptMap.has(d)) deptMap.set(d, { department: d, service: x.r.service, total: 0 });
        deptMap.get(d).total += x.v;
      });

      applyYearPayload(fy, {
        services: sum(expRows, 'service'),
        categories: sum(expRows, 'category'),
        departments: [...deptMap.values()].sort(function (a, b) { return b.total - a.total; }),
        tree: tree(expRows, ['service', 'department_name', 'division_name', 'category', 'description']),
        revenue: revRows.reduce(function (s, x) { return s + x.v; }, 0),
        revenueCategories: sum(revRows, 'category'),
        revenueTree: tree(revRows, ['category', 'department_name', 'description']),
        capital: res[3].length ? num(res[3][0].total) : 0,
        capitalProjects: res[2].map(function (r) {
          return {
            project: r.project_name || 'Unnamed project',
            department: r.department || '—',
            fund: r.fund || '—',
            amount: num(r.approved_amount)
          };
        }),
        lineItemCount: expRows.length
      });
    });
  }

  /* ---------------- rendering ---------------- */

  function render() {
    var fy = state.year;
    var total = state.services.reduce(function (s, r) { return s + r.value; }, 0);
    renderSubbar();

    var idx = -1;
    for (var i = 0; i < state.trend.length; i++) if (state.trend[i].year === String(fy)) idx = i;
    var prior = idx > 0 ? state.trend[idx - 1] : null;

    $('kpi-total').textContent = moneyShort(total);
    $('kpi-total-note').textContent = money(total) + ' adopted for FY' + fy;

    if (prior) {
      var delta = total - prior.value;
      var dpct = prior.value ? (delta / prior.value * 100) : 0;
      $('kpi-change').textContent = (delta >= 0 ? '+' : '−') + Math.abs(dpct).toFixed(1) + '%';
      $('kpi-change').style.color = delta >= 0 ? '' : '#d72524';
      $('kpi-change-note').textContent = (delta >= 0 ? 'Up ' : 'Down ') + moneyShort(Math.abs(delta)) +
        ' from FY' + prior.year;
    } else {
      $('kpi-change').textContent = '—';
      $('kpi-change-note').textContent = 'No prior year in this dataset';
    }

    var rev = state.revenueByYear[fy] || 0;
    $('kpi-revenue').textContent = rev ? moneyShort(rev) : '—';
    if (!rev) {
      $('kpi-revenue-note').textContent = 'Not published for this year';
    } else if (Math.abs(rev - total) < 1) {
      $('kpi-revenue-note').textContent = 'Balanced — revenues equal appropriations';
    } else {
      $('kpi-revenue-note').textContent = money(rev) + ' budgeted';
    }

    var cap = state.capitalByYear[fy] || 0;
    $('kpi-capital').textContent = cap ? moneyShort(cap) : '—';
    $('kpi-capital-note').textContent = cap ? money(cap) + ' approved' : 'Not published for this year';

    $('spending-sub').textContent = state.services.length + ' service areas · ' +
      money(total) + ' total · FY' + fy;
    barChart($('service-chart'), state.services, { title: 'Spending by service area' });
    $('service-table').innerHTML = serviceTable(state.services);

    barChart($('category-chart'), state.categories, { title: 'Spending by category' });
    trendChart($('trend-chart'), state.trend, fy);
    stackedChart($('composition-chart'), state.composition, fy);
    $('composition-table').innerHTML = compositionTable(state.composition);

    renderDetail();
    renderRevenues();
    renderCapital();
    renderCompare();
  }

  /* ---------------- wiring ---------------- */

  /* ==================================================================== *
   * Routing
   *
   * Every tab has its own URL, so a link can point at exactly one view:
   *
   *   #/overview/2027           overview for a fiscal year
   *   #/detail/2016             drill-down for a fiscal year
   *   #/compare/2011,2019,2027  comparison with those years selected
   *   #/faq                     a tab with nothing else to remember
   *
   * Hashes rather than paths, because GitHub Pages serves static files and
   * has no rewrite rules — /faq would 404 on reload. The hash survives.
   * ==================================================================== */

  function tabById(id) {
    for (var i = 0; i < TABS.length; i++) if (TABS[i].id === id) return TABS[i];
    return null;
  }

  /** Read the current hash into {tab, year, years}. Unknown values are dropped. */
  function parseHash() {
    var raw = location.hash.replace(/^#\/?/, '');
    if (!raw) return { tab: DEFAULT_TAB };

    // Pre-tabs links: #fy2015 and #detail / #spending.
    var legacyYear = raw.match(/^fy(\d{4})$/);
    if (legacyYear) return { tab: DEFAULT_TAB, year: legacyYear[1] };

    var parts = raw.split('/');
    var id = decodeURIComponent(parts[0] || '').toLowerCase();
    id = LEGACY_TABS[id] || id;
    if (!tabById(id)) return { tab: DEFAULT_TAB };

    var out = { tab: id };
    var arg = parts[1] || '';
    if (id === 'compare') {
      var picked = arg.split(',').filter(function (y) { return /^\d{4}$/.test(y); });
      if (picked.length) out.years = picked;
    } else if (/^\d{4}$/.test(arg)) {
      out.year = arg;
    }
    return out;
  }

  /** Build the canonical hash for the current state. */
  function buildHash() {
    var t = tabById(state.tab);
    if (!t) return '#/' + DEFAULT_TAB;
    if (t.id === 'compare' && state.compareYears.length) {
      return '#/compare/' + state.compareYears.slice().sort().join(',');
    }
    if (t.year && state.year) return '#/' + t.id + '/' + state.year;
    return '#/' + t.id;
  }

  /**
   * Write the canonical hash without triggering our own hashchange handler.
   * `push` adds a history entry (a deliberate navigation); otherwise the
   * current entry is rewritten (tidying up an equivalent URL).
   */
  var suppressHashChange = false;
  function syncHash(push) {
    var want = buildHash();
    if (location.hash === want) return;
    suppressHashChange = true;
    if (push) location.hash = want;
    else history.replaceState(null, '', want);
    setTimeout(function () { suppressHashChange = false; }, 0);
  }

  function showTab(id, opts) {
    var t = tabById(id) || tabById(DEFAULT_TAB);
    state.tab = t.id;

    TABS.forEach(function (x) {
      var panel = $('panel-' + x.id);
      var tab = $('tab-' + x.id);
      var on = x.id === t.id;
      if (panel) panel.hidden = !on;
      if (tab) {
        tab.setAttribute('aria-selected', String(on));
        tab.classList.toggle('tab--active', on);
        // Roving tabindex: only the selected tab is in the tab order.
        tab.tabIndex = on ? 0 : -1;
      }
    });

    // The fiscal-year picker only belongs on tabs scoped to a single year.
    $('subbar').hidden = !t.year;
    $('intro').hidden = t.id !== DEFAULT_TAB;

    document.title = (t.id === DEFAULT_TAB ? '' : t.title + ' — ') +
      'Budget Explorer — City of Cambridge, Massachusetts';

    if (opts && opts.focus) {
      var panel = $('panel-' + t.id);
      if (panel) panel.focus({ preventScroll: true });
    }
    if (opts && opts.scroll) window.scrollTo({ top: 0, behavior: 'auto' });
    renderSubbar();
  }

  /** Apply whatever the URL says. Called on load and on back/forward. */
  function applyRoute(opts) {
    var r = parseHash();

    if (r.years && r.years.length) {
      state.compareYears = r.years.filter(function (y) {
        return state.years.indexOf(y) !== -1;
      });
      if (!state.compareYears.length) state.compareYears = pickYears('recent3');
      renderYearPicker();
      renderCompare();
    }

    showTab(r.tab, opts);

    var wantYear = r.year && state.years.indexOf(r.year) !== -1 ? r.year : null;
    if (wantYear && wantYear !== state.year) {
      $('fy-select').value = wantYear;
      selectYear(wantYear, { silent: true });
    }
    syncHash(false);
  }

  function renderSubbar() {
    var el = $('subbar-total');
    if (!el) return;
    var t = state.trend.filter(function (p) { return p.year === state.year; })[0];
    el.textContent = t
      ? 'FY' + state.year + ' operating budget: ' + money(t.value)
      : '\u00a0';
  }

  /* Tabs follow the WAI-ARIA authoring practice: arrow keys move between tabs,
     Home/End jump to the ends, and only the selected tab is in the tab order.
     They are real <a href> elements, so they still work without JavaScript and
     can be copied, bookmarked and opened in a new window. */
  function wireTabs() {
    var list = TABS.map(function (t) { return $('tab-' + t.id); }).filter(Boolean);

    list.forEach(function (el, i) {
      el.addEventListener('click', function (e) {
        // Let modified clicks fall through to the browser (new tab/window).
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        var id = TABS[i].id;
        if (id === state.tab) return;
        showTab(id, { focus: true, scroll: true });
        syncHash(true);
      });

      el.addEventListener('keydown', function (e) {
        var step = { ArrowRight: 1, ArrowLeft: -1, Down: 1, Up: -1, ArrowDown: 1, ArrowUp: -1 }[e.key];
        var next = null;
        if (step) next = (i + step + list.length) % list.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = list.length - 1;
        if (next === null) return;
        e.preventDefault();
        list[next].focus();
        showTab(TABS[next].id, { scroll: true });
        syncHash(true);
      });
    });

    window.addEventListener('hashchange', function () {
      if (suppressHashChange) return;
      applyRoute({ scroll: true });
    });

    // In-page links such as "Next: drill into a department".
    document.addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('a[href^="#/"]') : null;
      if (!a || a.getAttribute('role') === 'tab') return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      location.hash = a.getAttribute('href');
    });
  }

  function selectYear(fy, opts) {
    state.year = String(fy);
    renderSubbar();
    if (!opts || !opts.silent) syncHash(false);
    setStatus('Loading FY' + fy + '…');
    state.detailOpen = {};
    state.detailAllExpanded = false;
    $('detail-expand').textContent = 'Expand all';

    loadYear(fy).then(function () {
      setStatus(null);
      render();
    }).catch(function () {
      // A missing snapshot file shouldn't break the page — fall back to the API.
      if (state.mode === 'snapshot') {
        return loadYearLive(fy).then(function () { setStatus(null); render(); });
      }
      throw new Error('load failed');
    }).catch(function (e) {
      setStatus('Could not load FY' + fy + ' from the open data portal: ' + e.message, true);
    });
  }

  function init() {
    wireTooltips();
    wireTabs();
    // Show the right tab before any data arrives, so the shell doesn't flash blank.
    showTab(parseHash().tab);

    $('fy-select').addEventListener('change', function () { selectYear(this.value); });

    $('detail-search').addEventListener('input', renderDetail);
    $('detail-export').addEventListener('click', exportDetail);
    $('detail-expand').addEventListener('click', function () {
      state.detailAllExpanded = !state.detailAllExpanded;
      this.textContent = state.detailAllExpanded ? 'Collapse all' : 'Expand all';
      if (!state.detailAllExpanded) state.detailOpen = {};
      renderDetail();
    });

    $('compare-search').addEventListener('input', renderCompare);
    $('compare-export').addEventListener('click', exportCompare);

    $('compare-years').addEventListener('change', function (e) {
      if (e.target.type !== 'checkbox') return;
      var y = e.target.value;
      var i = state.compareYears.indexOf(y);
      if (e.target.checked && i === -1) state.compareYears.push(y);
      if (!e.target.checked && i !== -1) state.compareYears.splice(i, 1);
      renderCompare();
      syncHash(false);
    });

    document.querySelectorAll('[data-years]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.compareYears = pickYears(btn.getAttribute('data-years'));
        renderYearPicker();
        renderCompare();
        syncHash(false);
      });
    });

    $('capital-export').addEventListener('click', exportCapital);

    // Expand/collapse for both trees, delegated so re-renders keep working.
    document.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-tree-key]') : null;
      if (t) {
        var k = t.getAttribute('data-tree-key');
        state.detailOpen[k] = !state.detailOpen[k];
        if (t.closest('#revenue-detail')) renderRevenues(); else renderDetail();
        return;
      }
      var c = e.target.closest ? e.target.closest('[data-cmp-key]') : null;
      if (c) {
        var ck = c.getAttribute('data-cmp-key');
        state.compareOpen[ck] = !state.compareOpen[ck];
        renderCompare();
      }
    });

    document.querySelectorAll('[data-toggle-table]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var target = $(btn.getAttribute('data-toggle-table'));
        var showing = !target.hidden;
        target.hidden = showing;
        btn.setAttribute('aria-expanded', String(!showing));
        var labels = btn.textContent.indexOf('detail') !== -1
          ? ['Show detail', 'Hide detail'] : ['View as table', 'Hide table'];
        btn.textContent = showing ? labels[0] : labels[1];
      });
    });

    setStatus('Loading budget data from data.cambridgema.gov…');

    // Content files are optional: the page still works without them.
    Promise.all([
      json('content/glossary.json', true),
      json('content/documents.json', true),
      json('content/faq.json', true)
    ]).then(function (c) {
      state.glossary = c[0];
      renderConceptTips();
      renderDocuments(c[1]);
      renderFaq(c[2]);
    });

    json('data/manifest.json', true).then(function (manifest) {
      if (manifest && manifest.generated) {
        state.mode = 'snapshot';
        $('freshness').textContent = 'Snapshot generated ' + manifest.generated +
          (manifest.counts ? ' from ' + manifest.counts.expenditures.toLocaleString() +
            ' expenditure rows.' : '.');
      } else {
        $('freshness').textContent = 'Queried live from the open data portal.';
      }
      // In snapshot mode the aliases were already applied at build time.
      return state.mode === 'snapshot' ? null : loadAliases();
    }).then(function () {
      return loadTrend();
    }).then(function (trend) {
      state.trend = trend;
      state.years = trend.map(function (p) { return p.year; });

      // Composition and comparison come from the snapshot when there is one,
      // and from two extra aggregate queries when there isn't.
      return Promise.all([
        state.mode === 'snapshot'
          ? json('data/composition.json', true)
          : loadCompositionLive(state.years).catch(function () { return null; }),
        state.mode === 'snapshot'
          ? json('data/matrix.json', true)
          : loadMatrixLive(state.years).catch(function () { return null; })
      ]);
    }).then(function (res) {
      state.composition = res[0];
      state.matrix = res[1];
      state.compareYears = pickYears('recent3');
      renderYearPicker();

      var sel = $('fy-select');
      sel.innerHTML = state.years.slice().reverse().map(function (y) {
        return '<option value="' + y + '">FY' + y + '</option>';
      }).join('');

      // Load the newest year first, then let the URL override it. Doing it in
      // that order means a bad or bookmarked-stale hash still lands on data.
      var route = parseHash();
      var start = (route.year && state.years.indexOf(route.year) !== -1)
        ? route.year : state.years[state.years.length - 1];
      sel.value = start;
      state.ready = true;
      selectYear(start, { silent: true });
      applyRoute();
    }).catch(function (e) {
      setStatus('Could not reach the open data portal: ' + e.message +
        ' — if you are offline, run the snapshot build script.', true);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
