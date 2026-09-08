
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
  result.stdout = renderText(data, testName);
  return result;
}
