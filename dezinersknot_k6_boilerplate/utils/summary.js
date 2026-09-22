
const OUT_DIR = __ENV.OUT_DIR || 'results';

function num(v, digits) {
  if (v === undefined || v === null || isNaN(v)) return '-';
  return Number(v).toFixed(digits === undefined ? 2 : digits);
}

function metricValues(data, name) {
  const m = data.metrics[name];
  return m ? m.values : {};
}
function thresholdLines(data) {
  const lines = [];
  for (const metricName in data.metrics) {
    const t = data.metrics[metricName].thresholds;
    if (!t) continue;
    for (const expression in t) {
      const ok = t[expression].ok;
      lines.push(`  ${ok ? 'PASS' : 'FAIL'}  ${metricName}: ${expression}`);
    }
  }
  return lines;
}

function sampleCount(metric) {
  const v = metric.values || {};

  if (metric.type === 'rate') return (v.passes || 0) + (v.fails || 0);
  if (metric.type === 'counter') return v.count || 0;
  if (metric.type === 'trend') {
    return v.avg === 0 && v.med === 0 && v.max === 0 ? 0 : 1;
  }

  return 1;
}

function unverifiedThresholds(data) {
  const names = [];
  for (const metricName in data.metrics) {
    const m = data.metrics[metricName];
    if (!m.thresholds) continue;
    if (sampleCount(m) === 0) names.push(metricName);
  }
  return names;
}
function customMetricLines(data) {
  const lines = [];
  const builtIn = ['http_req_duration', 'iteration_duration', 'group_duration'];

  for (const name in data.metrics) {
    if (name.slice(-9) !== '_duration') continue;
    if (builtIn.indexOf(name) !== -1) continue;
    const prefix = name.slice(0, -9);
    const dur = metricValues(data, name);
    const ok = metricValues(data, `${prefix}_success`);
    const errs = metricValues(data, `${prefix}_errors`);

    lines.push(`    ${prefix}`);
    if (ok.rate !== undefined) {
      lines.push(`      success rate       : ${num(ok.rate * 100)}%`);
    }
    lines.push(`      avg                : ${num(dur.avg)} ms`);
    lines.push(`      p(95)              : ${num(dur['p(95)'])} ms`);
    lines.push(`      max                : ${num(dur.max)} ms`);
    if (errs.count !== undefined) {
      lines.push(`      errors             : ${num(errs.count, 0)}`);
    }
  }
  return lines;
}

function diagnosticLines(data) {
  const lines = [];
  const httpClasses = [
    ['2xx', 'http_2xx'],
    ['4xx', 'http_4xx'],
    ['429', 'http_429'],
    ['5xx', 'http_5xx'],
    ['timeout', 'http_timeout'],
    ['transport', 'http_transport_error'],
  ];
  const classes = httpClasses
    .map(([label, name]) => `${label}=${num(metricValues(data, name).count, 0)}`)
    .join('  ');
  lines.push(`    HTTP classes          : ${classes}`);

  const payment = metricValues(data, 'payment_success_rate');
  if (payment.rate !== undefined) {
    lines.push(`    payment success rate  : ${num(payment.rate * 100)}%`);
  }
  return lines;
}

function htmlEscape(value) {
  return String(value === undefined || value === null ? '-' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function percent(value) {
  return value === undefined ? '-' : `${num(value * 100)}%`;
}

function htmlTable(headers, rows) {
  if (rows.length === 0) return '<p class="empty">No data recorded.</p>';
  return `<div class="table-wrap"><table><thead><tr>${headers
    .map((header) => `<th>${htmlEscape(header)}</th>`)
    .join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function renderHtml(data, testName) {
  const http = metricValues(data, 'http_req_duration');
  const failed = metricValues(data, 'http_req_failed');
  const checks = metricValues(data, 'checks');
  const iterations = metricValues(data, 'iterations');
  const requests = metricValues(data, 'http_reqs');
  const failedCount = (failed.passes || 0) + (failed.fails || 0);
  const checkCount = (checks.passes || 0) + (checks.fails || 0);
  const thresholds = [];

  for (const metricName in data.metrics) {
    const metric = data.metrics[metricName];
    if (!metric.thresholds) continue;
    const samples = sampleCount(metric);
    for (const expression in metric.thresholds) {
      const passed = metric.thresholds[expression].ok;
      const status = samples === 0 ? 'UNVERIFIED' : passed ? 'PASS' : 'FAIL';
      thresholds.push({ metricName, expression, status, samples });
    }
  }

  const hasFailure = thresholds.some((threshold) => threshold.status === 'FAIL');
  const hasUnverified = thresholds.some((threshold) => threshold.status === 'UNVERIFIED');
  const verdict = hasFailure ? 'FAILED' : hasUnverified ? 'PASSED WITH UNVERIFIED THRESHOLDS' : 'PASSED';
  const verdictClass = hasFailure ? 'fail' : hasUnverified ? 'warn' : 'pass';
  const endpointRows = [];

  for (const name in data.metrics) {
    if (name.slice(-9) !== '_duration' || name === 'http_req_duration' || name === 'iteration_duration' || name === 'group_duration') continue;
    const prefix = name.slice(0, -9);
    const duration = metricValues(data, name);
    const success = metricValues(data, `${prefix}_success`);
    const errors = metricValues(data, `${prefix}_errors`);
    endpointRows.push(
      `<tr><td>${htmlEscape(prefix)}</td><td>${percent(success.rate)}</td>` +
      `<td>${num(errors.count, 0)}</td><td>${num(duration.avg)} ms</td>` +
      `<td>${num(duration['p(95)'])} ms</td><td>${num(duration.max)} ms</td></tr>`
    );
  }

  const thresholdRows = thresholds.map(
    (threshold) =>
      `<tr><td><span class="badge ${threshold.status === 'FAIL' ? 'fail' : threshold.status === 'UNVERIFIED' ? 'warn' : 'pass'}">${threshold.status}</span></td>` +
      `<td>${htmlEscape(threshold.metricName)}</td><td>${htmlEscape(threshold.expression)}</td>` +
      `<td>${num(threshold.samples, 0)}</td></tr>`
  );
  const diagnosticRows = [
    ['2xx', 'http_2xx'],
    ['4xx', 'http_4xx'],
    ['429', 'http_429'],
    ['5xx', 'http_5xx'],
    ['Timeout', 'http_timeout'],
    ['Transport', 'http_transport_error'],
  ].map(([label, metric]) => `<tr><td>${label}</td><td>${num(metricValues(data, metric).count, 0)}</td></tr>`);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${htmlEscape(testName)} - k6 report</title><style>
:root { color-scheme: light dark; --bg:#f6f8fa; --card:#fff; --text:#1f2328; --muted:#57606a; --line:#d0d7de; --pass:#1a7f37; --fail:#cf222e; --warn:#9a6700; }
@media (prefers-color-scheme:dark) { :root { --bg:#0d1117; --card:#161b22; --text:#e6edf3; --muted:#8b949e; --line:#30363d; --pass:#3fb950; --fail:#f85149; --warn:#d29922; } }
* { box-sizing:border-box; } body { margin:0; padding:28px 16px 48px; background:var(--bg); color:var(--text); font:14px/1.5 system-ui,sans-serif; } main { max-width:1080px; margin:auto; } h1 { margin:0 0 4px; font-size:25px; } h2 { margin:30px 0 10px; font-size:17px; } .muted { color:var(--muted); } .verdict { margin:22px 0; padding:12px 15px; border-left:5px solid; background:var(--card); font-weight:700; } .pass { color:var(--pass); border-color:var(--pass); } .fail { color:var(--fail); border-color:var(--fail); } .warn { color:var(--warn); border-color:var(--warn); } .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; } .card { padding:12px; background:var(--card); border:1px solid var(--line); border-radius:7px; } .card b { display:block; font-size:19px; } .card span { color:var(--muted); font-size:12px; text-transform:uppercase; } .table-wrap { overflow-x:auto; background:var(--card); border:1px solid var(--line); border-radius:7px; } table { border-collapse:collapse; width:100%; } th,td { padding:9px 11px; text-align:left; border-bottom:1px solid var(--line); white-space:nowrap; } th { color:var(--muted); font-size:12px; text-transform:uppercase; } tr:last-child td { border:0; } .badge { display:inline-block; padding:2px 7px; border-radius:999px; font-size:11px; font-weight:700; } .badge.pass { background:color-mix(in srgb,var(--pass) 15%,transparent); } .badge.fail { background:color-mix(in srgb,var(--fail) 15%,transparent); } .badge.warn { background:color-mix(in srgb,var(--warn) 15%,transparent); } .empty { color:var(--muted); } footer { margin-top:32px; color:var(--muted); font-size:12px; }
</style></head><body><main>
<h1>${htmlEscape(testName)}</h1><p class="muted">k6 execution report generated ${htmlEscape(new Date().toISOString())}</p>
<div class="verdict ${verdictClass}">${verdict}</div>
<div class="cards"><div class="card"><b>${num(iterations.count, 0)}</b><span>Iterations</span></div><div class="card"><b>${num(requests.count, 0)}</b><span>Requests</span></div><div class="card"><b>${percent(failed.rate)}</b><span>Requests failed (${num(failed.passes, 0)}/${num(failedCount, 0)})</span></div><div class="card"><b>${num(http.avg)} ms</b><span>HTTP average</span></div><div class="card"><b>${num(http['p(95)'])} ms</b><span>HTTP p95</span></div><div class="card"><b>${num(checks.passes, 0)}/${num(checkCount, 0)}</b><span>Checks passed</span></div></div>
<h2>Per-endpoint</h2>${htmlTable(['Endpoint', 'Success', 'Errors', 'Average', 'p95', 'Max'], endpointRows)}
<h2>Thresholds</h2>${htmlTable(['Status', 'Metric', 'Expression', 'Samples'], thresholdRows)}
${hasUnverified ? '<p class="muted">Unverified means the metric had no samples, so k6 could not evaluate that threshold.</p>' : ''}
<h2>HTTP diagnostics</h2>${htmlTable(['Class', 'Count'], diagnosticRows)}
<footer>Self-contained report generated by utils/summary.js.</footer></main></body></html>`;
}

function renderText(data, testName) {
  const http = metricValues(data, 'http_req_duration');
  const failed = metricValues(data, 'http_req_failed');
  const checks = metricValues(data, 'checks');
  const iters = metricValues(data, 'iterations');

  const tLines = thresholdLines(data);
  const anyFailed = tLines.some((l) => l.indexOf('FAIL') !== -1);
  const unverified = unverifiedThresholds(data);

  let out = [];

  out.push('');
  out.push('='.repeat(62));
  out.push(`  RESULT: ${testName}`);
  out.push('='.repeat(62));
  out.push('');
  out.push('  Traffic');
  out.push(`    iterations completed : ${num(iters.count, 0)}`);
  out.push(
    `    requests failed      : ${num(failed.rate * 100)}%  (${num(failed.passes, 0)} of ${num(failed.passes + failed.fails, 0)})`
  );
  out.push('');
  out.push('  Response time (all requests)');
  out.push(`    avg                  : ${num(http.avg)} ms`);
  out.push(`    p(95)                : ${num(http['p(95)'])} ms`);
  out.push(`    max                  : ${num(http.max)} ms`);
  out.push('');
  out.push('  Per-endpoint');
  out = out.concat(customMetricLines(data));
  out.push('');
  out.push('  Diagnostics');
  out = out.concat(diagnosticLines(data));
  out.push('');
  out.push('  Checks');
  out.push(`    passed               : ${num(checks.passes, 0)}`);
  out.push(`    failed               : ${num(checks.fails, 0)}`);
  out.push('');
  out.push('  Thresholds');
  out = out.concat(tLines.length ? tLines : ['    (none defined)']);

  if (unverified.length) {
    out.push('');
    out.push('  ⚠ UNVERIFIED — matched zero samples, so k6 never evaluated');
    out.push('    them and reported PASS by default. Almost always a tag that');
    out.push('    no check or request actually sets.');
    for (let i = 0; i < unverified.length; i++) {
      out.push(`      ${unverified[i]}`);
    }
  }

  out.push('');

  let overall = 'PASSED';
  if (anyFailed) {
    overall = 'FAILED — a threshold was breached';
  } else if (unverified.length) {
    overall = `PASSED — but ${unverified.length} threshold(s) were never evaluated`;
  }
  out.push(`  OVERALL: ${overall}`);
  out.push('='.repeat(62));
  out.push('');

  return out.join('\n');
}
export function summaryReport(data, testName) {
  const result = {};
  result[`${OUT_DIR}/${testName}.json`] = JSON.stringify(data, null, 2);
  result[`${OUT_DIR}/${testName}.html`] = renderHtml(data, testName);
  result.stdout = renderText(data, testName);
  return result;
}
