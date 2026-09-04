import { spawn } from 'node:child_process';
import { appendFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const selected = option('--selected');
const sibling = option('--sibling');
const holdMs = Number(option('--hold-ms') ?? '0');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await sleep(250);

const child = spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 700)'], {
  stdio: 'ignore',
});

if (selected) {
  const original = join(selected, 'observed.txt');
  const renamed = join(selected, 'observed-renamed.txt');
  writeFileSync(original, 'one');
  await sleep(100);
  appendFileSync(original, '-two');
  await sleep(100);
  renameSync(original, renamed);
  await sleep(100);
  rmSync(renamed, { force: true });
}

if (sibling) {
  writeFileSync(join(sibling, 'outside.txt'), 'outside');
}

await new Promise((resolve, reject) => {
  child.once('exit', resolve);
  child.once('error', reject);
});

if (holdMs > 0) await sleep(holdMs);
await sleep(250);
