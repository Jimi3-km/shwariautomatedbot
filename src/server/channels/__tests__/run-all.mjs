/**
 * Runs every *.test.mjs under src/ and fails if any suite fails.
 *
 * Each suite is its own process (they stub global fetch and set environment
 * variables at import time, so they cannot share one). Invoked by `npm test`.
 */

import { readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

function find(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) find(full, out);
    else if (name.endsWith('.test.mjs')) out.push(full);
  }
  return out;
}

const suites = find(path.join(root, 'src')).sort();
const tsx = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const failed = [];

for (const suite of suites) {
  const rel = path.relative(root, suite).replace(/\\/g, '/');
  const run = spawnSync(process.execPath, [tsx, suite], {
    cwd: root,
    encoding: 'utf8',
    timeout: 180_000,
    env: { ...process.env, SHWARI_HOUSEKEEPING: 'off' },
  });
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const summary = output.split('\n').filter((l) => /\d+ passed, \d+ failed/.test(l)).pop();

  if (run.status === 0) {
    console.log(`ok    ${rel}  ${summary ?? ''}`.trimEnd());
  } else {
    failed.push(rel);
    console.log(`FAIL  ${rel}  ${summary ?? `(exit ${run.status ?? run.signal})`}`);
    for (const line of output.split('\n').filter((l) => /^FAIL|^\s{6}\S|Error/.test(l)).slice(0, 12)) {
      console.log(`      ${line.trim()}`);
    }
  }
}

console.log(`\n${suites.length - failed.length}/${suites.length} suites passed`);
process.exit(failed.length ? 1 : 0);
