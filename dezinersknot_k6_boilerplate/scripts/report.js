#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const RESULTS_DIR = path.join(REPO_ROOT, 'results');
const REPORTS_DIR = path.join(REPO_ROOT, 'reports');

const useColour = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (useColour ? `[${code}m${s}[0m` : s);
const red = (s) => paint('31', s);
const green = (s) => paint('32', s);
const yellow = (s) => paint('33', s);

const BUILTIN_DURATIONS = ['http_req_duration', 'iteration_duration', 'group_duration'];
const TREND_STATS = ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)'];

function sampleCount(metric) {
  const v = metric.values || {};

  if (metric.type === 'rate') return (v.passes || 0) + (v.fails || 0);
  if (metric.type === 'counter') return v.count || 0;
  if (metric.type === 'trend') {
    return v.avg === 0 && v.med === 0 && v.max === 0 ? 0 : 1;
  }
  return 1;
}


function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function num(v, digits) {
  if (v === undefined || v === null || isNaN(v)) return '-';
  return Number(v).toFixed(digits === undefined ? 2 : digits);
}

function pct(v) {
  if (v === undefined || v === null || isNaN(v)) return '-';
  return `${num(v * 100)}%`;
}

function ms(v) {
  if (v === undefined || v === null || isNaN(v)) return '-';
  const base = `${num(v)} ms`;
  return v >= 1000 ? `${base} (${num(v / 1000)} s)` : base;
}

function bytes(v) {
  if (v === undefined || v === null || isNaN(v)) return '-';
  if (v >= 1024 * 1024) return `${num(v / (1024 * 1024))} MB`;
  if (v >= 1024) return `${num(v / 1024)} kB`;
  return `${num(v, 0)} B`;
}

function duration(msTotal) {
  if (msTotal === undefined || msTotal === null || isNaN(msTotal)) return '-';
  const s = msTotal / 1000;
  if (s < 60) return `${num(s)} s`;
  const mins = Math.floor(s / 60);
  return `${mins}m ${num(s - mins * 60, 1)}s`;
}

function isTimeMetric(metric) {
  return metric.contains === 'time';
}


function values(data, name) {
  const m = data.metrics[name];
  return m && m.values ? m.values : {};
}

function thresholdRows(data) {
  const rows = [];
  for (const name of Object.keys(data.metrics)) {
    const metric = data.metrics[name];
    if (!metric || !metric.thresholds) continue;

    const samples = sampleCount(metric);
    for (const expression of Object.keys(metric.thresholds)) {
      let status = 'PASS';
      if (!metric.thresholds[expression].ok) status = 'FAIL';
      else if (samples === 0) status = 'UNVERIFIED';
      rows.push({ name, expression, status, samples, type: metric.type });
    }
  }
  return rows;
}

function endpointRows(data) {
  const rows = [];
  for (const name of Object.keys(data.metrics)) {
    if (!name.endsWith('_duration')) continue;
    if (BUILTIN_DURATIONS.indexOf(name) !== -1) continue;

    const prefix = name.slice(0, -'_duration'.length);
    const dur = values(data, name);
    rows.push({
      name: prefix,
      success: values(data, `${prefix}_success`).rate,
      errors: values(data, `${prefix}_errors`).count,
      avg: dur.avg,
      med: dur.med,
      p95: dur['p(95)'],
      max: dur.max,
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

function collectChecks(group, prefix, out) {
  const label = group.name ? `${prefix}${group.name} / ` : prefix;
  for (const check of group.checks || []) {
    out.push({
      group: group.name || '',
      name: `${label}${check.name}`,
      passes: check.passes || 0,
      fails: check.fails || 0,
    });
  }
  for (const child of group.groups || []) collectChecks(child, label, out);
  return out;
}

function checkRows(data) {
  return data.root_group ? collectChecks(data.root_group, '', []) : [];
}

function metricRows(data) {
  const trends = [];
  const others = [];

  for (const name of Object.keys(data.metrics).sort()) {
    const metric = data.metrics[name];
    const v = metric.values || {};
    if (metric.type === 'trend') {
      trends.push({ name, time: isTimeMetric(metric), values: v });
    } else {
      others.push({ name, type: metric.type, time: isTimeMetric(metric), values: v });
    }
  }
  return { trends, others };
}

function verdict(rows) {
  const breached = rows.filter((r) => r.status === 'FAIL').length;
  const unverified = rows.filter((r) => r.status === 'UNVERIFIED').length;

  if (breached > 0) {
    return {
      level: 'fail',
      text: `FAILED — ${breached} threshold${breached === 1 ? '' : 's'} breached`,
      breached,
      unverified,
    };
  }
  if (unverified > 0) {
    return {
      level: 'warn',
      text:
        unverified === 1
          ? 'PASSED — but 1 threshold was never evaluated'
          : `PASSED — but ${unverified} thresholds were never evaluated`,
      breached,
      unverified,
    };
  }
  if (rows.length === 0) {
    return { level: 'warn', text: 'NO THRESHOLDS DEFINED — nothing was asserted', breached: 0, unverified: 0 };
  }
  return { level: 'pass', text: 'PASSED — all thresholds evaluated and met', breached: 0, unverified: 0 };
}


const CSS = `
:root {
  color-scheme: light dark;
  --bg: #f6f7f9;
  --panel: #ffffff;
  --ink: #1a1d21;
  --muted: #5d666f;
  --line: #e2e6ea;
  --pass: #1a7f45;
  --pass-bg: #e6f4ec;
  --fail: #b3261e;
  --fail-bg: #fbeae9;
  --warn: #8a5a00;
  --warn-bg: #fdf3e2;
  --mono: ui-monospace, SFMono-Regular, "Cascadia Mono", Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #16181c;
    --panel: #1e2126;
    --ink: #e8eaed;
    --muted: #9aa4af;
    --line: #2e333a;
    --pass: #6ede9a;
    --pass-bg: #16301f;
    --fail: #ff8a80;
    --fail-bg: #351b1a;
    --warn: #f0c063;
    --warn-bg: #33280f;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 2rem 1.25rem 4rem;
  background: var(--bg);
  color: var(--ink);
  font: 15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif;
}
main { max-width: 1080px; margin: 0 auto; }
h1 { font-size: 1.5rem; margin: 0 0 .25rem; }
h1 span { color: var(--muted); font-weight: 400; }
h2 { font-size: 1.05rem; margin: 2.25rem 0 .75rem; }
.meta { color: var(--muted); font-size: .85rem; margin: 0 0 1.25rem; }
.meta code { font-family: var(--mono); }
.verdict {
  padding: .85rem 1rem; border-radius: 8px; font-weight: 600;
  border: 1px solid transparent; margin-bottom: 1.5rem;
}
.verdict.pass { background: var(--pass-bg); color: var(--pass); border-color: var(--pass); }
.verdict.fail { background: var(--fail-bg); color: var(--fail); border-color: var(--fail); }
.verdict.warn { background: var(--warn-bg); color: var(--warn); border-color: var(--warn); }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: .75rem; }
.tile {
  background: var(--panel); border: 1px solid var(--line);
  border-radius: 8px; padding: .8rem .9rem;
}
.tile .k { color: var(--muted); font-size: .75rem; text-transform: uppercase; letter-spacing: .04em; }
.tile .v { font-size: 1.25rem; font-weight: 600; margin-top: .2rem; font-variant-numeric: tabular-nums; }
.tile .v.small { font-size: 1rem; }
.wrap { overflow-x: auto; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; }
table { border-collapse: collapse; width: 100%; font-size: .875rem; }
th, td { text-align: left; padding: .55rem .8rem; border-bottom: 1px solid var(--line); white-space: nowrap; }
th { color: var(--muted); font-weight: 600; font-size: .78rem; text-transform: uppercase; letter-spacing: .03em; }
tr:last-child td { border-bottom: none; }
td.n { text-align: right; font-variant-numeric: tabular-nums; }
td.name, td.expr { font-family: var(--mono); font-size: .82rem; white-space: normal; }
.badge {
  display: inline-block; padding: .1rem .5rem; border-radius: 999px;
  font-size: .72rem; font-weight: 700; letter-spacing: .03em;
}
.badge.pass { background: var(--pass-bg); color: var(--pass); }
.badge.fail { background: var(--fail-bg); color: var(--fail); }
.badge.warn { background: var(--warn-bg); color: var(--warn); }
.note {
  background: var(--warn-bg); color: var(--warn); border: 1px solid var(--warn);
  border-radius: 8px; padding: .75rem 1rem; font-size: .85rem; margin-top: .75rem;
}
.empty { color: var(--muted); font-size: .875rem; padding: .75rem 0; }
footer { color: var(--muted); font-size: .78rem; margin-top: 3rem; border-top: 1px solid var(--line); padding-top: .75rem; }
`;

function badge(status) {
  const cls = status === 'FAIL' ? 'fail' : status === 'UNVERIFIED' ? 'warn' : 'pass';
  return `<span class="badge ${cls}">${status}</span>`;
}

function tile(key, value, small) {
  return `<div class="tile"><div class="k">${esc(key)}</div><div class="v${small ? ' small' : ''}">${esc(value)}</div></div>`;
}

function table(headers, rows) {
  if (!rows.length) return '<p class="empty">none</p>';
  const head = headers.map((h) => `<th>${esc(h.label)}</th>`).join('');
  const body = rows
    .map((cells) => `<tr>${cells.map((c, i) => `<td class="${headers[i].cls || ''}">${c}</td>`).join('')}</tr>`)
    .join('\n      ');
  return `<div class="wrap"><table>\n      <thead><tr>${head}</tr></thead>\n      <tbody>\n      ${body}\n      </tbody>\n    </table></div>`;
}

function render(data, testName, sourceFile, generatedAt) {
  const http = values(data, 'http_req_duration');
  const failed = values(data, 'http_req_failed');
  const checks = values(data, 'checks');
  const iters = values(data, 'iterations');
  const reqs = values(data, 'http_reqs');
  const vus = values(data, 'vus_max');
  const runMs = data.state ? data.state.testRunDurationMs : undefined;

  const tRows = thresholdRows(data);
  const v = verdict(tRows);
  const eRows = endpointRows(data);
  const cRows = checkRows(data);
  const { trends, others } = metricRows(data);

  const totalReqs = (failed.passes || 0) + (failed.fails || 0);
  const checkTotal = (checks.passes || 0) + (checks.fails || 0);

  const tiles = [
    tile('iterations', num(iters.count, 0)),
    tile('requests', num(reqs.count, 0)),
    // On http_req_failed, k6's `passes` is the count that FAILED.
    tile('requests failed', `${pct(failed.rate)}`, false),
    tile('checks passed', checkTotal ? `${num(checks.passes, 0)} / ${num(checkTotal, 0)}` : '-', true),
    tile('http p(95)', ms(http['p(95)']), true),
    tile('http max', ms(http.max), true),
    tile('max VUs', num(vus.max !== undefined ? vus.max : vus.value, 0)),
    tile('run duration', duration(runMs)),
    tile('throughput', reqs.rate !== undefined ? `${num(reqs.rate)} req/s` : '-', true),
  ].join('\n      ');

  const thresholdTable = table(
    [{ label: 'Status' }, { label: 'Metric', cls: 'name' }, { label: 'Expression', cls: 'expr' }, { label: 'Samples', cls: 'n' }],
    tRows.map((r) => [badge(r.status), esc(r.name), esc(r.expression), r.samples === 0 ? '0' : num(r.samples, 0)])
  );

  const unverifiedNote = v.unverified
    ? `<div class="note"><strong>UNVERIFIED</strong> means the threshold's tag matched zero samples, so k6
       never evaluated it and reported it green with exit code 0. Fix the tag it is scoped to —
       do not delete the threshold.</div>`
    : '';

  const endpointTable = table(
    [
      { label: 'Endpoint', cls: 'name' },
      { label: 'Success', cls: 'n' },
      { label: 'Errors', cls: 'n' },
      { label: 'avg', cls: 'n' },
      { label: 'med', cls: 'n' },
      { label: 'p(95)', cls: 'n' },
      { label: 'max', cls: 'n' },
    ],
    eRows.map((r) => [
      esc(r.name),
      r.success === undefined ? '-' : pct(r.success),
      r.errors === undefined ? '-' : num(r.errors, 0),
      ms(r.avg),
      ms(r.med),
      ms(r.p95),
      ms(r.max),
    ])
  );

  const checkTable = table(
    [{ label: 'Status' }, { label: 'Check', cls: 'name' }, { label: 'Passed', cls: 'n' }, { label: 'Failed', cls: 'n' }],
    cRows.map((c) => [
      badge(c.fails > 0 ? 'FAIL' : 'PASS'),
      esc(c.name),
      num(c.passes, 0),
      num(c.fails, 0),
    ])
  );

  const trendTable = table(
    [{ label: 'Metric', cls: 'name' }].concat(TREND_STATS.map((s) => ({ label: s, cls: 'n' }))),
    trends.map((m) =>
      [esc(m.name)].concat(TREND_STATS.map((s) => (m.time ? ms(m.values[s]) : num(m.values[s]))))
    )
  );

  const otherTable = table(
    [{ label: 'Metric', cls: 'name' }, { label: 'Type' }, { label: 'Value', cls: 'n' }, { label: 'Detail', cls: 'n' }],
    others.map((m) => {
      const val = m.values;
      if (m.type === 'rate') {
        return [esc(m.name), 'rate', pct(val.rate), `${num(val.passes, 0)} / ${num((val.passes || 0) + (val.fails || 0), 0)}`];
      }
      if (m.type === 'counter') {
        const count = m.values.count;
        return [
          esc(m.name),
          'counter',
          m.name.startsWith('data_') ? bytes(count) : num(count, 0),
          val.rate !== undefined ? `${num(val.rate)}/s` : '-',
        ];
      }
      return [esc(m.name), esc(m.type), num(val.value !== undefined ? val.value : val.max), '-'];
    })
  );

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>k6 report — ${esc(testName)}</title>
  <style>${CSS}</style>
</head>
<body>
  <main>
    <h1>${esc(testName)} <span>— k6 report</span></h1>
    <p class="meta">
      source <code>${esc(path.relative(REPO_ROOT, sourceFile).split(path.sep).join('/'))}</code>
      &middot; run duration ${esc(duration(runMs))}
      &middot; generated ${esc(generatedAt)}
    </p>

    <div class="verdict ${v.level}">${esc(v.text)}</div>

    <div class="tiles">
      ${tiles}
    </div>

    <h2>Thresholds</h2>
    ${thresholdTable}
    ${unverifiedNote}

    <h2>Per-endpoint (custom metrics)</h2>
    ${endpointTable}

    <h2>Checks</h2>
    ${checkTable}

    <h2>Trend metrics</h2>
    ${trendTable}

    <h2>Counters, rates and gauges</h2>
    ${otherTable}

    <footer>
      Generated by <code>scripts/report.js</code> from a k6 summary export.
      p(95) is the number to tune against — avg hides your worst users.
      On <code>http_req_failed</code>, k6's <code>passes</code> is the count that failed.
    </footer>
  </main>
</body>
</html>
`;
}

function resolveFiles(argv) {
  if (argv.length > 0) {
    const missing = argv.filter((f) => !fs.existsSync(f));
    if (missing.length) {
      console.error(red(`ERROR: no such result file(s): ${missing.join(', ')}`));
      console.error('       Did k6 actually run? Results are written relative to your CWD.');
      process.exit(1);
    }
    return argv;
  }

  if (!fs.existsSync(RESULTS_DIR)) {
    console.error(red(`ERROR: results directory not found: ${RESULTS_DIR}`));
    process.exit(1);
  }

  const files = fs
    .readdirSync(RESULTS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(RESULTS_DIR, f));

  if (files.length === 0) {
    console.error(red(`ERROR: no result JSON in ${RESULTS_DIR}`));
    process.exit(1);
  }

  return files;
}

function parseArgs(argv) {
  const files = [];
  let outDir = REPORTS_DIR;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out-dir' || a === '-o') {
      outDir = argv[++i];
      if (!outDir) {
        console.error(red('ERROR: --out-dir needs a directory'));
        process.exit(1);
      }
    } else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/report.js [result.json ...] [--out-dir DIR]');
      console.log('  No arguments: renders every results/*.json.');
      process.exit(0);
    } else {
      files.push(a);
    }
  }
  return { files, outDir: path.resolve(outDir) };
}

function main() {
  const { files: named, outDir } = parseArgs(process.argv.slice(2));
  const files = resolveFiles(named);
  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  fs.mkdirSync(outDir, { recursive: true });

  console.log('');
  console.log('=== k6 HTML report ===');

  let failures = 0;
  for (const file of files) {
    const source = path.resolve(file);
    const testName = path.basename(source, '.json');

    let data;
    try {
      data = JSON.parse(fs.readFileSync(source, 'utf8'));
    } catch (e) {
      console.log(`  ${red('SKIP')}  ${testName}: unreadable — ${e.message}`);
      failures++;
      continue;
    }

    if (!data || typeof data.metrics !== 'object' || data.metrics === null) {
      console.log(`  ${red('SKIP')}  ${testName}: no 'metrics' object — not a k6 summary export?`);
      failures++;
      continue;
    }

    const html = render(data, testName, source, generatedAt);
    const target = path.join(outDir, `${testName}.html`);
    fs.writeFileSync(target, html, 'utf8');

    const v = verdict(thresholdRows(data));
    const mark = v.level === 'fail' ? red('FAIL') : v.level === 'warn' ? yellow('WARN') : green('PASS');
    console.log(`  ${mark}  ${path.relative(process.cwd(), target).split(path.sep).join('/')}`);
  }

  console.log('');
  if (failures > 0) {
    console.log(red(`${failures} file(s) could not be rendered.`));
    process.exit(1);
  }
  console.log('Open the HTML in a browser. Threshold gating: node scripts/check-thresholds.js <file>');
  process.exit(0);
}

main();
