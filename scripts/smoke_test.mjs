#!/usr/bin/env node

import { existsSync, mkdtempSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');
const fixture = join(projectRoot, 'tests', 'fixtures', 'toc-highlight.md');
const temporary = mkdtempSync(join(tmpdir(), 'md2pdf-smoke-'));
const output = join(temporary, 'smoke.pdf');

try {
  const result = spawnSync(
    process.execPath,
    [
      join(projectRoot, 'convert.mjs'),
      fixture,
      output,
      '--toc', 'on',
      '--highlight', 'auto',
      '--diagram', 'auto',
    ],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 180000,
      windowsHide: true,
    },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `converter exited with ${result.status}`);
  }
  if (!existsSync(output) || statSync(output).size < 10000) {
    throw new Error('converter did not create a non-empty PDF');
  }
  process.stdout.write('md2pdf smoke test passed\n');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
