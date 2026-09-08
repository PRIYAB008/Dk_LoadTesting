#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const RESULTS_DIR = path.join(REPO_ROOT, 'results');

const useColour = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (useColour ? `[${code}m${s}[0m` : s);
const red = (s) => paint('31', s);
const green = (s) => paint('32', s);
const yellow = (s) => paint('33', s);


function sampleCount(metric) {
  const v = metric.values || {};

  if (metric.type === 'rate') return (v.passes || 0) + (v.fails || 0);
  if (metric.type === 'counter') return v.count || 0;
  if (metric.type === 'trend') {
    return v.avg === 0 && v.med === 0 && v.max === 0 ? 0 : 1;
  }
  return 1;
}

function inspect(file) {
  const breached = [];
  const unverified = [];
  let evaluated = 0;

  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return { fatal: `unreadable — ${e.message}` };
  }

  if (!data || typeof data.metrics !== 'object' || data.metrics === null) {
    return { fatal: "no 'metrics' object — not a k6 summary export?" };
  }

  for (const name of Object.keys(data.metrics)) {
    const metric = data.metrics[name];
    if (!metric || !metric.thresholds) continue;

    for (const expression of Object.keys(metric.thresholds)) {
      evaluated++;
      if (!metric.thresholds[expression].ok) {
        breached.push(`${name}: ${expression}`);
      }
    }

    if (sampleCount(metric) === 0) {
      unverified.push(`${name}  [${metric.type}]`);
    }
  }

  return { breached, unverified, evaluated };
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
    console.error('       A run that produced nothing to check is not a pass.');
    process.exit(1);
  }

  return files;
}

function main() {
  const files = resolveFiles(process.argv.slice(2));
  let totalBreached = 0;
  let totalUnverified = 0;
  console.log('');
  console.log('=== k6 threshold gate ===');
  if (process.argv.length <= 2) {
    console.log('  (auditing every stored result, including old runs —');
    console.log('   for a CI gate, name the file the run just produced)');
  }
  for (const file of files) {
    const name = path.basename(file);
    const r = inspect(file);
    if (r.fatal) {
      console.log(`  ${red('FAIL')}  ${name}: ${r.fatal}`);
      totalBreached++;
      continue;
    }
    totalBreached += r.breached.length;
    totalUnverified += r.unverified.length;
    if (r.breached.length === 0 && r.unverified.length === 0) {
      console.log(`  ${green('PASS')}  ${name} (${r.evaluated} threshold(s) evaluated)`);
      continue;
    }
    console.log(`  ${red('FAIL')}  ${name}`);
    r.breached.forEach((b) => console.log(`          ${red('BREACHED')}    ${b}`));
    r.unverified.forEach((u) => console.log(`          ${yellow('UNVERIFIED')}  ${u}`));
  }
  console.log('');
  if (totalBreached > 0 || totalUnverified > 0) {
    console.log(red(`${totalBreached} breached, ${totalUnverified} unverified.`));
    if (totalUnverified > 0) {
      console.log('UNVERIFIED means the threshold matched zero samples and was never');
      console.log('evaluated. Fix the tag it is scoped to — do not delete the threshold.');
    }
    process.exit(1);
  }
  console.log(green('All thresholds evaluated and met.'));
  process.exit(0);
}
main();
