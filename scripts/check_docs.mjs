#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { dirname, extname, resolve } from 'path';
import { fileURLToPath } from 'url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const excludedDirectories = new Set(['.git', 'node_modules']);

function collectMarkdown(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    if (excludedDirectories.has(entry)) continue;
    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) files.push(...collectMarkdown(path));
    else if (extname(path).toLowerCase() === '.md') files.push(path);
  }
  return files;
}

const missing = [];
const markdownLink = /\[[^\]]*\]\(([^)]+)\)/g;

function withoutFencedCode(content) {
  const output = [];
  let fence = null;
  for (const line of content.split(/\r?\n/)) {
    const opening = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (!fence && opening) {
      fence = { character: opening[1][0], length: opening[1].length };
      output.push('');
      continue;
    }
    if (fence) {
      const closing = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
      if (closing && closing[1][0] === fence.character && closing[1].length >= fence.length) {
        fence = null;
      }
      output.push('');
    } else {
      output.push(line);
    }
  }
  return output.join('\n');
}

for (const markdown of collectMarkdown(projectRoot)) {
  const content = withoutFencedCode(readFileSync(markdown, 'utf8'));
  for (const match of content.matchAll(markdownLink)) {
    const rawTarget = match[1].trim().replace(/^<|>$/g, '');
    if (!rawTarget || /^(?:https?:|mailto:|#)/i.test(rawTarget)) continue;
    const pathPart = rawTarget.split('#', 1)[0];
    let decoded;
    try {
      decoded = decodeURIComponent(pathPart);
    } catch {
      decoded = pathPart;
    }
    const target = resolve(dirname(markdown), decoded);
    if (!existsSync(target)) missing.push(`${markdown}: ${rawTarget}`);
  }
}

if (missing.length) {
  process.stderr.write(`Broken local documentation links:\n${missing.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write('documentation links passed\n');
