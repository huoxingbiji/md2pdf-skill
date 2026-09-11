#!/usr/bin/env node

/**
 * md2pdf v1.2
 * Markdown -> quality-gated A4 PDF with clickable TOC, syntax highlighting,
 * KaTeX, Mermaid and optional watermarking.
 */

import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
} from 'fs';
import http from 'http';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { basename, dirname, extname, join, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import katex from 'katex';
import hljs from 'highlight.js';
import { marked } from 'marked';
import puppeteer from 'puppeteer';

const require = createRequire(import.meta.url);
const SKILL_DIR = dirname(fileURLToPath(import.meta.url));
const KATEX_DIST_DIR = dirname(require.resolve('katex'));
const KATEX_FONTS_DIR = join(KATEX_DIST_DIR, 'fonts');
const POSTPROCESS_SCRIPT = join(SKILL_DIR, 'scripts', 'postprocess_pdf.py');

const CONFIG = {
  page: {
    format: 'A4',
    margin: { top: '20mm', right: '18mm', bottom: '20mm', left: '18mm' },
  },
  fonts: {
    body: '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", "Helvetica Neue", Arial, sans-serif',
    code: '"Cascadia Code", "Fira Code", "JetBrains Mono", Consolas, monospace',
  },
  colors: {
    primary: '#1b4965',
    primaryLight: '#bee988',
    text: '#1a1a1a',
    textLight: '#334155',
    codeBg: '#1e293b',
    codeText: '#e2e8f0',
    tableHeader: '#1b4965',
    tableHeaderText: '#ffffff',
    tableBorder: '#cbd5e1',
    tableRowEven: '#f8fafc',
    blockquoteBg: '#f0f7fb',
    blockquoteBorder: '#1b4965',
    headingBorder: '#bee988',
  },
  mermaid: {
    theme: 'base',
    fontSize: '14px',
    nodeSpacing: 34,
    rankSpacing: 44,
  },
};

function printUsage() {
  console.log(`用法：node convert.mjs <input.md> [output.pdf] [options]

选项：
  --toc off|on|auto
  --highlight auto|off
  --math auto|off
  --repair-markdown safe|off
  --diagram auto|normal|full-page
  --date-folder
  --watermark <text>
  --watermark-opacity <0..1>
  --watermark-angle <-180..180>
  --owner-password-env <environment-variable-name>
  --header-footer on|off
  --help`);
}

function takeOptionValue(argv, index, inlineValue, optionName) {
  if (inlineValue !== undefined) return { value: inlineValue, nextIndex: index };
  if (index + 1 >= argv.length || argv[index + 1].startsWith('--')) {
    throw new Error(`${optionName} 缺少参数`);
  }
  return { value: argv[index + 1], nextIndex: index + 1 };
}

function parseArgs(argv) {
  const options = {
    toc: 'off',
    highlight: 'auto',
    math: 'auto',
    repairMarkdown: 'safe',
    diagram: 'auto',
    dateFolder: false,
    watermark: '',
    watermarkOpacity: 0.12,
    watermarkAngle: -35,
    ownerPasswordEnv: '',
    headerFooter: 'on',
  };
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    if (arg === '--help') return { help: true, positional, options };
    if (arg === '--date-folder') {
      options.dateFolder = true;
      continue;
    }

    const equalAt = arg.indexOf('=');
    const name = equalAt >= 0 ? arg.slice(0, equalAt) : arg;
    const inlineValue = equalAt >= 0 ? arg.slice(equalAt + 1) : undefined;
    const { value, nextIndex } = takeOptionValue(argv, i, inlineValue, name);
    i = nextIndex;

    switch (name) {
      case '--toc': options.toc = value; break;
      case '--highlight': options.highlight = value; break;
      case '--math': options.math = value; break;
      case '--repair-markdown': options.repairMarkdown = value; break;
      case '--diagram': options.diagram = value; break;
      case '--watermark': options.watermark = value; break;
      case '--watermark-opacity': options.watermarkOpacity = Number(value); break;
      case '--watermark-angle': options.watermarkAngle = Number(value); break;
      case '--owner-password-env': options.ownerPasswordEnv = value; break;
      case '--header-footer': options.headerFooter = value; break;
      default: throw new Error(`未知选项：${name}`);
    }
  }

  if (!['off', 'on', 'auto'].includes(options.toc)) throw new Error('--toc 必须是 off、on 或 auto');
  if (!['auto', 'off'].includes(options.highlight)) throw new Error('--highlight 必须是 auto 或 off');
  if (!['auto', 'off'].includes(options.math)) throw new Error('--math 必须是 auto 或 off');
  if (!['safe', 'off'].includes(options.repairMarkdown)) throw new Error('--repair-markdown 必须是 safe 或 off');
  if (!['auto', 'normal', 'full-page'].includes(options.diagram)) throw new Error('--diagram 必须是 auto、normal 或 full-page');
  if (!['on', 'off'].includes(options.headerFooter)) throw new Error('--header-footer 必须是 on 或 off');
  if (!Number.isFinite(options.watermarkOpacity) || options.watermarkOpacity < 0 || options.watermarkOpacity > 1) {
    throw new Error('--watermark-opacity 必须在 0 到 1 之间');
  }
  if (!Number.isFinite(options.watermarkAngle) || options.watermarkAngle < -180 || options.watermarkAngle > 180) {
    throw new Error('--watermark-angle 必须在 -180 到 180 之间');
  }
  if (positional.length > 2) throw new Error('位置参数过多');
  return { help: false, positional, options };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function todayLocal() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function protectFencedBlocks(markdown) {
  const lines = markdown.split(/\r?\n/);
  const output = [];
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const opening = lines[i].match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!opening) {
      output.push(lines[i]);
      i += 1;
      continue;
    }

    const marker = opening[1];
    const markerChar = marker[0];
    const minimumLength = marker.length;
    const closingPattern = new RegExp(`^ {0,3}${escapeRegExp(markerChar)}{${minimumLength},}[ \\t]*$`);
    const startLine = i + 1;
    const blockLines = [lines[i]];
    i += 1;
    let closed = false;
    while (i < lines.length) {
      blockLines.push(lines[i]);
      if (closingPattern.test(lines[i])) {
        closed = true;
        i += 1;
        break;
      }
      i += 1;
    }
    if (!closed) throw new Error(`第 ${startLine} 行开始的代码围栏未闭合`);
    const token = `MD2PDFFENCEDBLOCK${blocks.length}TOKEN`;
    blocks.push({ token, value: blockLines.join('\n') });
    output.push(token);
  }

  return { text: output.join('\n'), blocks };
}

function protectInlineCode(markdown) {
  const spans = [];
  const text = markdown.replace(/(`+)([^\r\n]*?)\1/g, (match) => {
    const token = `MD2PDFINLINECODE${spans.length}TOKEN`;
    spans.push({ token, value: match });
    return token;
  });
  return { text, spans };
}

function restoreProtected(markdown, inlineSpans, fencedBlocks) {
  let result = markdown;
  for (const span of inlineSpans) result = result.split(span.token).join(span.value);
  for (const block of fencedBlocks) result = result.split(block.token).join(block.value);
  return result;
}

function safeRepairStrongSpacing(markdown) {
  const changedLines = [];
  const lines = markdown.split('\n').map((line, index) => {
    const repaired = line
      .replace(/\*\*[ \t]+([^*\r\n]+?)[ \t]*\*\*/g, '**$1**')
      .replace(/\*\*([^*\r\n]+?)[ \t]+\*\*/g, '**$1**')
      .replace(/(\*\*[^*\r\n]*[，。！？；：、,.!?;:]\*\*)(?=\S)/g, '$1 ');
    if (repaired !== line) changedLines.push(index + 1);
    return repaired;
  });
  return { text: lines.join('\n'), changedLines };
}

function looksLikeInlineMath(expression) {
  const value = expression.trim();
  if (!value || value !== expression) return false;
  if (/\\|[_^{}=<>+*/]|\\(?:frac|sum|prod|text|mathrm|operatorname|min|max)/.test(value)) return true;
  if (/^[A-Za-z][A-Za-z0-9,]*$/.test(value) && value.length <= 12) return true;
  if (/^[A-Za-z0-9]+\s*[+\-×÷=<>]\s*[A-Za-z0-9]+$/.test(value)) return true;
  return false;
}

function renderMathTokens(markdown, enabled) {
  if (!enabled) return { text: markdown, replacements: [], displayCount: 0, inlineCount: 0 };
  const delimiterCount = (markdown.match(/\$\$/g) || []).length;
  if (delimiterCount % 2 !== 0) throw new Error('检测到未配对的 $$ 数学公式分隔符');

  const replacements = [];
  let displayCount = 0;
  let inlineCount = 0;
  const randomPart = crypto.randomBytes(6).toString('hex').toUpperCase();

  let text = markdown.replace(/\$\$([\s\S]*?)\$\$/g, (_match, expression) => {
    const source = expression.trim();
    let html;
    try {
      html = katex.renderToString(source, {
        displayMode: true,
        throwOnError: true,
        strict: 'ignore',
        trust: false,
        output: 'htmlAndMathml',
      });
    } catch (error) {
      throw new Error(`KaTeX 块公式解析失败：${source.slice(0, 160)}\n${error.message}`);
    }
    const token = `MD2PDFMATHBLOCK${randomPart}${replacements.length}TOKEN`;
    replacements.push({ token, html: `<div class="math-block">${html}</div>`, display: true });
    displayCount += 1;
    return `\n${token}\n`;
  });

  text = text.replace(/(^|[^\\$])\$([^\r\n$]+?)\$/g, (match, prefix, expression) => {
    if (!looksLikeInlineMath(expression)) return match;
    let html;
    try {
      html = katex.renderToString(expression, {
        displayMode: false,
        throwOnError: true,
        strict: 'ignore',
        trust: false,
        output: 'htmlAndMathml',
      });
    } catch (error) {
      throw new Error(`KaTeX 行内公式解析失败：${expression.slice(0, 160)}\n${error.message}`);
    }
    const token = `MD2PDFMATHINLINE${randomPart}${replacements.length}TOKEN`;
    replacements.push({ token, html: `<span class="math-inline">${html}</span>`, display: false });
    inlineCount += 1;
    return `${prefix}${token}`;
  });

  return { text, replacements, displayCount, inlineCount };
}

function restoreMathInHtml(html, replacements) {
  let result = html;
  for (const replacement of replacements) {
    if (replacement.display) {
      const wrapped = new RegExp(`<p>\\s*${escapeRegExp(replacement.token)}\\s*<\\/p>`, 'g');
      result = result.replace(wrapped, replacement.html);
    }
    result = result.split(replacement.token).join(replacement.html);
  }
  return result;
}

function plainHeadingText(value) {
  return String(value)
    .replace(/!\[([^\]]*)\]\([^\)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^\)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*|__|~~|`/g, '')
    .replace(/\\([\\`*_[\]{}()#+\-.!])/g, '$1')
    .trim();
}

function extractHeadings(markdown) {
  return marked.lexer(markdown, { gfm: true })
    .filter((token) => token.type === 'heading')
    .map((token) => ({
      level: token.depth,
      rawText: token.text,
      text: plainHeadingText(token.text),
    }));
}

function hasTableOfContents(markdown) {
  return extractHeadings(markdown).some(
    (heading) => heading.level <= 3 && /^(目录|Table of Contents|TOC)$/i.test(heading.text),
  );
}

function createHeadingIdFactory() {
  const seen = new Map();
  return (value) => {
    const normalized = plainHeadingText(value)
      .normalize('NFKC')
      .toLowerCase()
      .replace(/&(?:[a-z0-9]+|#\d+|#x[a-f0-9]+);/gi, ' ')
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-') || 'section';
    const occurrence = (seen.get(normalized) || 0) + 1;
    seen.set(normalized, occurrence);
    return occurrence === 1 ? normalized : `${normalized}-${occurrence}`;
  };
}

function assignHeadingIds(headings) {
  const nextId = createHeadingIdFactory();
  return headings.map((heading) => ({ ...heading, id: nextId(heading.text) }));
}

function escapeMarkdownLinkText(value) {
  return value.replace(/([\\\[\]])/g, '\\$1');
}

function generateTocItems(headings, generatedTocIndex) {
  let skippedDocumentTitle = false;
  return headings
    .filter((heading, index) => {
      if (index === generatedTocIndex || heading.level > 3) return false;
      if (!skippedDocumentTitle && heading.level === 1) {
        skippedDocumentTitle = true;
        return false;
      }
      return true;
    })
    .map((heading) => {
      const indent = '  '.repeat(Math.max(0, heading.level - 2));
      const label = escapeMarkdownLinkText(heading.text);
      return `${indent}- [${label}](#${encodeURIComponent(heading.id)})`;
    })
    .join('\n');
}

function insertToc(markdown, toc) {
  const lines = markdown.split(/\r?\n/);
  const firstHeading = lines.findIndex((line) => /^#\s+/.test(line));
  let insertAt = firstHeading >= 0 ? firstHeading + 1 : 0;
  while (insertAt < lines.length && (lines[insertAt].trim() === '' || /^>/.test(lines[insertAt]))) insertAt += 1;
  lines.splice(insertAt, 0, '', toc, '');
  return lines.join('\n');
}

function extractTitle(markdown, inputPath) {
  const heading = extractHeadings(markdown).find((item) => item.level === 1);
  if (heading) return heading.text;
  return basename(inputPath, extname(inputPath));
}

function prepareMarkdown(source, options) {
  let markdown = source;
  const sourceHeadings = extractHeadings(markdown);
  const lineCount = markdown.split(/\r?\n/).length;
  const tocPresent = hasTableOfContents(markdown);
  const shouldAddToc = options.toc === 'on' || (options.toc === 'auto' && lineCount > 500 && !tocPresent);
  const tocAdded = shouldAddToc && !tocPresent;
  let headingRenderQueue;
  let tocLinkCount = 0;
  if (tocAdded) {
    const tocItemsToken = `MD2PDFTOCITEMS${crypto.randomBytes(6).toString('hex').toUpperCase()}TOKEN`;
    markdown = insertToc(markdown, `## 目录\n\n${tocItemsToken}\n\n---\n`);
    headingRenderQueue = assignHeadingIds(extractHeadings(markdown));
    const generatedTocIndex = headingRenderQueue.findIndex(
      (heading) => heading.level === 2 && heading.text === '目录',
    );
    if (generatedTocIndex < 0) throw new Error('无法定位临时生成的目录标题');
    headingRenderQueue[generatedTocIndex].id = 'md2pdf-toc';
    const tocItems = generateTocItems(headingRenderQueue, generatedTocIndex);
    tocLinkCount = tocItems ? tocItems.split('\n').filter((line) => /\]\(#/.test(line)).length : 0;
    markdown = markdown.replace(tocItemsToken, tocItems || '- 暂无可列出的章节');
  } else {
    headingRenderQueue = assignHeadingIds(sourceHeadings);
  }

  const protectedFences = protectFencedBlocks(markdown);
  const protectedInline = protectInlineCode(protectedFences.text);
  let editable = protectedInline.text;
  let repairLines = [];
  if (options.repairMarkdown === 'safe') {
    const repaired = safeRepairStrongSpacing(editable);
    editable = repaired.text;
    repairLines = repaired.changedLines;
  }

  const remainingStrongSpacing = editable
    .split('\n')
    .map((line, index) => {
      const markers = Array.from(line.matchAll(/\*\*/g));
      if (markers.length % 2 !== 0) return index + 1;
      for (let marker = 0; marker < markers.length; marker += 2) {
        const inner = line.slice(markers[marker].index + 2, markers[marker + 1].index);
        if (/^[ \t]|[ \t]$/.test(inner)) return index + 1;
      }
      return null;
    })
    .filter(Boolean);
  const math = renderMathTokens(editable, options.math === 'auto');
  const restored = restoreProtected(math.text, protectedInline.spans, protectedFences.blocks);

  return {
    markdown: restored,
    mathReplacements: math.replacements,
    stats: {
      lineCount,
      headingCount: sourceHeadings.length,
      fencedBlockCount: protectedFences.blocks.length,
      mermaidCount: protectedFences.blocks.filter((block) => /^ {0,3}`{3,}\s*mermaid\b|^ {0,3}~{3,}\s*mermaid\b/i.test(block.value)).length,
      displayMathCount: math.displayCount,
      inlineMathCount: math.inlineCount,
      tocAdded,
      tocPresent: tocPresent || shouldAddToc,
      tocLinkCount,
      repairCount: repairLines.length,
      repairLines,
      remainingStrongSpacing,
    },
    headingRenderQueue,
  };
}

function loadKatexCss() {
  const cssPath = join(KATEX_DIST_DIR, 'katex.min.css');
  return readFileSync(cssPath, 'utf8').replace(
    /url\(fonts\/([^\)]+)\)/g,
    "url('/__katex/fonts/$1')",
  );
}

const LANGUAGE_ALIASES = {
  csharp: 'csharp',
  'c#': 'csharp',
  cs: 'csharp',
  docker: 'dockerfile',
  html: 'xml',
  js: 'javascript',
  jsx: 'javascript',
  md: 'markdown',
  ps1: 'powershell',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  ts: 'typescript',
  tsx: 'typescript',
  yml: 'yaml',
};

const AUTO_DETECT_LANGUAGES = [
  'javascript', 'typescript', 'python', 'java', 'csharp', 'cpp',
  'sql', 'json', 'bash', 'powershell', 'yaml', 'xml', 'css',
  'markdown', 'go', 'rust', 'ruby', 'php', 'kotlin', 'swift',
];

function normalizeLanguage(value) {
  const language = String(value || '').trim().toLowerCase();
  return LANGUAGE_ALIASES[language] || language;
}

function safeLanguageClass(value) {
  return String(value || 'text').toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'text';
}

function highlightCode(text, requestedLanguage, enabled) {
  const plain = { html: escapeHtml(text), language: requestedLanguage || 'text', highlighted: false, autoDetected: false };
  if (!enabled) return plain;

  const normalized = normalizeLanguage(requestedLanguage);
  if (normalized) {
    if (!hljs.getLanguage(normalized)) return { ...plain, unknownLanguage: requestedLanguage };
    const result = hljs.highlight(text, { language: normalized, ignoreIllegals: true });
    return { html: result.value, language: result.language || normalized, highlighted: true, autoDetected: false };
  }

  const compactLength = text.replace(/\s+/g, '').length;
  if (compactLength < 24 || text.length > 50000) return plain;
  const result = hljs.highlightAuto(text, AUTO_DETECT_LANGUAGES);
  if (!result.language || result.relevance < 4) return plain;
  return { html: result.value, language: result.language, highlighted: true, autoDetected: true };
}

function generateHtml(prepared, title, options, nonce) {
  const renderer = new marked.Renderer();
  const headingQueue = prepared.headingRenderQueue.slice();
  const fallbackHeadingId = createHeadingIdFactory();
  const highlightStats = {
    codeBlockCount: 0,
    highlightedCodeBlocks: 0,
    autoDetectedCodeBlocks: 0,
    plainCodeBlocks: 0,
    languages: {},
    unknownLanguages: [],
  };

  renderer.heading = function ({ tokens, depth, text }) {
    const heading = headingQueue.shift();
    const id = heading?.id || fallbackHeadingId(text || this.parser.parseInline(tokens));
    return `<h${depth} id="${escapeHtml(id)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
  };

  renderer.code = function ({ text, lang }) {
    const info = String(lang || '').trim();
    const parts = info.split(/\s+/).filter(Boolean);
    if ((parts[0] || '').toLowerCase() === 'mermaid') {
      const requested = parts.includes('full-page') ? 'full-page' : (parts.includes('normal') ? 'normal' : 'auto');
      return `<div class="mermaid" data-layout="${requested}">${escapeHtml(text)}</div>`;
    }
    highlightStats.codeBlockCount += 1;
    const highlighted = highlightCode(text, parts[0] || '', options.highlight === 'auto');
    if (highlighted.highlighted) {
      highlightStats.highlightedCodeBlocks += 1;
      if (highlighted.autoDetected) highlightStats.autoDetectedCodeBlocks += 1;
      highlightStats.languages[highlighted.language] = (highlightStats.languages[highlighted.language] || 0) + 1;
    } else {
      highlightStats.plainCodeBlocks += 1;
    }
    if (highlighted.unknownLanguage && !highlightStats.unknownLanguages.includes(highlighted.unknownLanguage)) {
      highlightStats.unknownLanguages.push(highlighted.unknownLanguage);
    }
    const displayLanguage = highlighted.language || parts[0] || 'text';
    const languageClass = safeLanguageClass(displayLanguage);
    const highlightedClass = highlighted.highlighted ? ' code-highlighted' : '';
    return `<pre class="code-block${highlightedClass}" data-language="${escapeHtml(displayLanguage)}"><code class="hljs language-${languageClass}">${highlighted.html}</code></pre>`;
  };

  let htmlBody = marked.parse(prepared.markdown, { renderer, gfm: true, breaks: false });
  htmlBody = restoreMathInHtml(htmlBody, prepared.mathReplacements);
  const mermaidJs = readFileSync(join(SKILL_DIR, 'mermaid.min.js'), 'utf8');
  const katexCss = loadKatexCss();

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'nonce-${nonce}'">
  <style>${katexCss}</style>
  <style>
    @page { size: A4; margin: 20mm 18mm; }
    @page md2pdf-landscape { size: A4 landscape; margin: 18mm 16mm; }
    * { box-sizing: border-box; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { width: 100%; }
    body {
      font-family: ${CONFIG.fonts.body};
      font-size: 11pt;
      line-height: 1.7;
      color: ${CONFIG.colors.text};
      margin: 0;
      padding: 0;
      overflow-wrap: break-word;
    }
    h1, h2, h3, h4 { break-after: avoid-page; page-break-after: avoid; }
    h1 {
      font-size: 20pt; font-weight: 700; color: #0d1b2a;
      border-bottom: 3px solid ${CONFIG.colors.primary};
      padding-bottom: 8px; margin: 24px 0 16px;
    }
    h2 {
      font-size: 16pt; font-weight: 700; color: ${CONFIG.colors.primary};
      border-bottom: 2px solid ${CONFIG.colors.headingBorder};
      padding-bottom: 6px; margin: 20px 0 12px;
    }
    h3 { font-size: 13pt; font-weight: 600; color: #274c77; margin: 16px 0 10px; }
    h4 { font-size: 12pt; font-weight: 600; color: #415a77; margin: 14px 0 8px; }
    a { color: ${CONFIG.colors.primary}; text-decoration: none; }
    a[href^="#"] { border-bottom: 1px dotted #94a3b8; }
    #md2pdf-toc + ul {
      padding: 12px 18px 12px 34px; margin: 10px 0 18px;
      background: #f8fafc; border: 1px solid #dbe5ee; border-radius: 6px;
    }
    #md2pdf-toc + ul li { margin: 5px 0; }
    #md2pdf-toc + ul a { font-weight: 500; }
    p { margin: 6px 0; text-align: justify; orphans: 3; widows: 3; }
    blockquote {
      border-left: 4px solid ${CONFIG.colors.blockquoteBorder};
      background: ${CONFIG.colors.blockquoteBg}; color: ${CONFIG.colors.textLight};
      margin: 12px 0; padding: 10px 16px; font-style: italic;
    }
    blockquote p { margin: 4px 0; }
    table {
      border-collapse: collapse; width: 100%; margin: 12px 0;
      font-size: 10pt; break-inside: auto; page-break-inside: auto;
      table-layout: auto;
    }
    thead { display: table-header-group; background: ${CONFIG.colors.tableHeader}; color: ${CONFIG.colors.tableHeaderText}; }
    tfoot { display: table-footer-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    th { padding: 8px 10px; text-align: left; font-weight: 600; border: 1px solid ${CONFIG.colors.tableHeader}; }
    td { padding: 7px 10px; border: 1px solid ${CONFIG.colors.tableBorder}; vertical-align: top; overflow-wrap: anywhere; }
    tbody tr:nth-child(even) { background: ${CONFIG.colors.tableRowEven}; }
    pre {
      background: ${CONFIG.colors.codeBg}; color: ${CONFIG.colors.codeText};
      padding: 12px 16px; border-radius: 6px; font-size: 9.5pt;
      line-height: 1.5; margin: 10px 0; white-space: pre-wrap;
      overflow-wrap: anywhere; word-break: break-word; break-inside: auto;
    }
    pre.code-block { position: relative; padding-top: 30px; }
    pre.code-block::before {
      content: attr(data-language); position: absolute; top: 7px; right: 12px;
      color: #94a3b8; font-family: ${CONFIG.fonts.code}; font-size: 7.5pt;
      font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
    }
    pre.code-block code.hljs { display: block; padding: 0; color: ${CONFIG.colors.codeText}; background: transparent; }
    .hljs-comment, .hljs-quote { color: #94a3b8; font-style: italic; }
    .hljs-keyword, .hljs-selector-tag, .hljs-literal, .hljs-section, .hljs-link { color: #f472b6; }
    .hljs-string, .hljs-title, .hljs-name, .hljs-type, .hljs-attribute, .hljs-symbol,
    .hljs-bullet, .hljs-addition, .hljs-variable, .hljs-template-tag, .hljs-template-variable { color: #86efac; }
    .hljs-number, .hljs-meta, .hljs-built_in, .hljs-builtin-name, .hljs-params { color: #fbbf24; }
    .hljs-function .hljs-title, .hljs-title.function_, .hljs-title.class_ { color: #7dd3fc; }
    .hljs-regexp, .hljs-selector-id, .hljs-selector-class { color: #c4b5fd; }
    .hljs-operator, .hljs-punctuation { color: #cbd5e1; }
    .hljs-deletion { color: #fca5a5; }
    .hljs-emphasis { font-style: italic; }
    .hljs-strong { font-weight: 700; }
    code { font-family: ${CONFIG.fonts.code}; }
    p code, li code, td code {
      background: #f1f5f9; color: #be185d; padding: 1px 5px;
      border-radius: 3px; font-size: 9.5pt; overflow-wrap: anywhere;
    }
    ul, ol { padding-left: 24px; margin: 6px 0; }
    li { margin: 3px 0; }
    hr { border: 0; border-top: 2px solid #e2e8f0; margin: 20px 0; }
    img { max-width: 100%; height: auto; break-inside: avoid; }
    .keep-together { break-inside: avoid !important; page-break-inside: avoid !important; }
    .keep-with-next { break-after: avoid-page !important; page-break-after: avoid !important; }
    .math-block {
      display: flex; justify-content: center; align-items: center;
      margin: 12px 0; padding: 4px 0; max-width: 100%;
      overflow: visible; break-inside: avoid; page-break-inside: avoid;
    }
    .math-block .katex-display { margin: 0; max-width: 100%; }
    .math-inline { white-space: nowrap; }
    .katex { font-size: 1.02em; }
    .mermaid {
      display: flex; justify-content: center; align-items: center;
      width: 100%; margin: 16px 0; break-inside: avoid;
      page-break-inside: avoid; overflow: visible;
    }
    .mermaid svg { width: 100%; max-width: 100% !important; height: auto; max-height: 190mm !important; }
    .mermaid-full-page {
      min-height: 220mm; margin: 0; padding: 4mm 0;
      break-before: page; page-break-before: always;
      break-after: page; page-break-after: always;
    }
    .mermaid-full-page svg { max-height: 218mm !important; }
    .mermaid-landscape {
      page: md2pdf-landscape;
      min-height: 164mm;
      padding: 2mm 0;
    }
    .mermaid-landscape svg { max-height: 160mm !important; }
    .mermaid-render-error {
      color: #991b1b; border: 2px solid #dc2626; background: #fef2f2;
      padding: 12px; white-space: pre-wrap;
    }
  </style>
</head>
<body>
${htmlBody}

<script nonce="${nonce}">${mermaidJs}</script>
<script nonce="${nonce}">
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: '${CONFIG.mermaid.theme}',
    themeVariables: {
      primaryColor: '${CONFIG.colors.primaryLight}',
      primaryTextColor: '#0d1b2a',
      primaryBorderColor: '${CONFIG.colors.primary}',
      lineColor: '#415a77',
      secondaryColor: '#f0f7fb',
      tertiaryColor: '#ffffff',
      fontSize: '${CONFIG.mermaid.fontSize}',
      fontFamily: ${JSON.stringify(CONFIG.fonts.body)}
    },
    flowchart: {
      htmlLabels: true,
      curve: 'basis',
      padding: 15,
      nodeSpacing: ${CONFIG.mermaid.nodeSpacing},
      rankSpacing: ${CONFIG.mermaid.rankSpacing},
      useMaxWidth: true
    }
  });

  window.__MD2PDF_RENDER_STATE__ = { done: false, errors: [], mermaidCount: 0, svgCount: 0 };
  (async () => {
    const state = window.__MD2PDF_RENDER_STATE__;
    const diagrams = Array.from(document.querySelectorAll('.mermaid'));
    state.mermaidCount = diagrams.length;
    for (let index = 0; index < diagrams.length; index += 1) {
      const diagram = diagrams[index];
      try {
        if (typeof mermaid.run === 'function') {
          await mermaid.run({ nodes: [diagram], suppressErrors: false });
        } else {
          await mermaid.init(undefined, diagram);
        }
        const svg = diagram.querySelector('svg');
        if (!svg) throw new Error('Mermaid 未生成 SVG');
        state.svgCount += 1;

        const viewBox = svg.viewBox && svg.viewBox.baseVal;
        const width = viewBox && viewBox.width ? viewBox.width : svg.getBoundingClientRect().width;
        const height = viewBox && viewBox.height ? viewBox.height : svg.getBoundingClientRect().height;
        const nodeCount = diagram.querySelectorAll('.node, .actor, .stateGroup, .cluster').length;
        const requested = diagram.dataset.layout || 'auto';
        const globalMode = ${JSON.stringify(options.diagram)};
        const fullPage = requested === 'full-page' || globalMode === 'full-page' || (
          requested !== 'normal' && globalMode === 'auto' &&
          (nodeCount >= 14 || width >= 900 || height >= 600 || (height > 0 && width / height >= 1.65))
        );
        if (fullPage) {
          diagram.classList.add('mermaid-full-page');
          if (height > 0 && width / height >= 1.35) diagram.classList.add('mermaid-landscape');
        }
      } catch (error) {
        state.errors.push('图表 ' + (index + 1) + ': ' + (error && error.message ? error.message : String(error)));
        diagram.classList.add('mermaid-render-error');
      }
    }
    state.done = true;
  })();
</script>
</body>
</html>`;
  return { html, highlightStats };
}

const MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

function pathInside(root, candidate) {
  const rootResolved = resolve(root);
  const candidateResolved = resolve(candidate);
  return candidateResolved === rootResolved || candidateResolved.startsWith(`${rootResolved}${sep}`);
}

function sendFile(res, root, relativePath) {
  const candidate = resolve(root, relativePath);
  if (!pathInside(root, candidate) || !existsSync(candidate) || !statSync(candidate).isFile()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME_TYPES[extname(candidate).toLowerCase()] || 'application/octet-stream' });
  createReadStream(candidate).pipe(res);
}

async function startServer(html, documentRoot) {
  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
    const pathname = decodeURIComponent(requestUrl.pathname);
    if (pathname === '/' || pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    if (pathname.startsWith('/__katex/fonts/')) {
      sendFile(res, KATEX_FONTS_DIR, pathname.slice('/__katex/fonts/'.length));
      return;
    }
    sendFile(res, documentRoot, pathname.replace(/^\/+/, ''));
  });
  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  return server;
}

function findPython() {
  const candidates = [];
  if (process.env.MD2PDF_PYTHON) candidates.push(process.env.MD2PDF_PYTHON);
  if (process.env.USERPROFILE) {
    candidates.push(join(
      process.env.USERPROFILE,
      '.cache', 'codex-runtimes', 'codex-primary-runtime',
      'dependencies', 'python', 'python.exe',
    ));
  }
  candidates.push('python');
  for (const candidate of candidates) {
    if (candidate.includes(sep) && !existsSync(candidate)) continue;
    const check = spawnSync(candidate, ['--version'], { encoding: 'utf8', windowsHide: true });
    if (!check.error && check.status === 0) return candidate;
  }
  throw new Error('水印/加密需要 Python，但未找到可用解释器；可通过 MD2PDF_PYTHON 指定');
}

function findBrowserExecutable() {
  const candidates = [process.env.MD2PDF_BROWSER];
  if (process.platform === 'win32') {
    if (process.env.ProgramFiles) {
      candidates.push(join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      candidates.push(join(process.env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    }
    if (process.env['ProgramFiles(x86)']) {
      candidates.push(join(process.env['ProgramFiles(x86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'));
      candidates.push(join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    }
    if (process.env.LOCALAPPDATA) {
      candidates.push(join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      candidates.push(join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    }
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    candidates.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  } else {
    candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser');
  }
  try { candidates.push(puppeteer.executablePath()); } catch { /* use discovered system browser */ }
  const executable = candidates.filter(Boolean).find((candidate) => existsSync(candidate));
  if (!executable) {
    throw new Error('未找到 Chrome/Edge；可通过 MD2PDF_BROWSER 指定浏览器可执行文件');
  }
  return executable;
}

function postprocessPdf(inputPath, outputPath, options) {
  const needsPostprocess = Boolean(options.watermark || options.ownerPasswordEnv);
  if (!needsPostprocess) return;
  if (!existsSync(POSTPROCESS_SCRIPT)) throw new Error(`缺少后处理脚本：${POSTPROCESS_SCRIPT}`);
  if (options.ownerPasswordEnv && !process.env[options.ownerPasswordEnv]) {
    throw new Error(`环境变量 ${options.ownerPasswordEnv} 未设置，无法应用所有者密码`);
  }
  const args = [POSTPROCESS_SCRIPT, inputPath, outputPath];
  if (options.watermark) args.push('--watermark', options.watermark);
  args.push('--opacity', String(options.watermarkOpacity));
  args.push('--angle', String(options.watermarkAngle));
  if (options.ownerPasswordEnv) args.push('--owner-password-env', options.ownerPasswordEnv);
  const result = spawnSync(findPython(), args, {
    encoding: 'utf8',
    env: process.env,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`PDF 水印/加密失败：${result.stderr || result.stdout || result.error || 'unknown error'}`);
  }
  if (result.stdout.trim()) console.log(result.stdout.trim());
}

function finalizePdf(tempPath, outputPath) {
  try {
    copyFileSync(tempPath, outputPath);
    return { path: outputPath, fallback: false };
  } catch (error) {
    if (!existsSync(outputPath)) throw error;
    const fallback = outputPath.replace(/\.pdf$/i, '_new.pdf');
    copyFileSync(tempPath, fallback);
    return { path: fallback, fallback: true, warning: `目标文件被占用，已回退到 ${fallback}` };
  }
}

async function generatePdf(html, inputPath, outputPath, title, options, expectedStats) {
  mkdirSync(dirname(outputPath), { recursive: true });
  const server = await startServer(html, dirname(inputPath));
  const port = server.address().port;
  const allowedOrigin = `http://127.0.0.1:${port}`;
  const suffix = crypto.randomBytes(6).toString('hex');
  const tempPdf = join(dirname(outputPath), `.${basename(outputPath, '.pdf')}.${suffix}.tmp.pdf`);
  const processedPdf = join(dirname(outputPath), `.${basename(outputPath, '.pdf')}.${suffix}.post.pdf`);
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: findBrowserExecutable(),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = request.url();
      if (url.startsWith(allowedOrigin) || url.startsWith('data:') || url === 'about:blank') request.continue();
      else request.abort('blockedbyclient');
    });
    await page.goto(`${allowedOrigin}/`, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.waitForFunction(() => window.__MD2PDF_RENDER_STATE__?.done === true, { timeout: 45000 });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images).map((image) => {
        if (image.complete) return Promise.resolve();
        return new Promise((resolvePromise) => {
          image.addEventListener('load', resolvePromise, { once: true });
          image.addEventListener('error', resolvePromise, { once: true });
        });
      }));
    });

    const diagnostics = await page.evaluate(() => {
      const state = window.__MD2PDF_RENDER_STATE__;
      const brokenImages = Array.from(document.images)
        .filter((image) => !image.complete || image.naturalWidth === 0)
        .map((image) => image.getAttribute('src'));
      const internalLinks = Array.from(document.querySelectorAll('a[href^="#"]'));
      const brokenInternalLinks = internalLinks
        .map((link) => link.getAttribute('href') || '')
        .filter((href) => {
          try {
            return !document.getElementById(decodeURIComponent(href.slice(1)));
          } catch {
            return true;
          }
        });
      const highlightedCodeBlocks = document.querySelectorAll('pre.code-highlighted').length;
      const highlightTokenCount = document.querySelectorAll('pre.code-highlighted code.hljs span[class*="hljs-"]').length;
      const contentPageHeight = (297 - 40) * (96 / 25.4);
      for (const element of document.querySelectorAll('table, pre, blockquote')) {
        if (element.getBoundingClientRect().height <= contentPageHeight * 0.48) element.classList.add('keep-together');
      }
      for (const paragraph of document.querySelectorAll('p')) {
        const text = (paragraph.textContent || '').trim();
        if (text.length <= 20 && /[：:]$/.test(text) && paragraph.nextElementSibling) {
          paragraph.classList.add('keep-with-next');
        }
      }
      const overflow = Array.from(document.querySelectorAll('body *'))
        .filter((element) => {
          if (element.closest('.katex')) return false;
          if (['SVG', 'PATH', 'G', 'SPAN', 'MATH', 'SEMANTICS', 'ANNOTATION'].includes(element.tagName)) return false;
          return element.scrollWidth > element.clientWidth + 3 && getComputedStyle(element).overflowX === 'visible';
        })
        .slice(0, 20)
        .map((element) => ({ tag: element.tagName, text: (element.textContent || '').trim().slice(0, 100) }));
      return {
        ...state,
        brokenImages,
        internalLinkCount: internalLinks.length,
        brokenInternalLinks,
        highlightedCodeBlocks,
        highlightTokenCount,
        overflow,
      };
    });

    if (diagnostics.errors.length) throw new Error(`Mermaid 渲染失败：\n${diagnostics.errors.join('\n')}`);
    if (diagnostics.svgCount !== expectedStats.mermaidCount) {
      throw new Error(`Mermaid SVG 数量不一致：${diagnostics.svgCount}/${expectedStats.mermaidCount}`);
    }
    if (diagnostics.brokenImages.length) {
      throw new Error(`图片加载失败：${diagnostics.brokenImages.join(', ')}`);
    }
    if (diagnostics.brokenInternalLinks.length) {
      throw new Error(`目录或文内链接目标不存在：${diagnostics.brokenInternalLinks.join(', ')}`);
    }
    if (expectedStats.tocAdded && diagnostics.internalLinkCount < expectedStats.tocLinkCount) {
      throw new Error(`目录链接数量不一致：${diagnostics.internalLinkCount}/${expectedStats.tocLinkCount}`);
    }
    if (diagnostics.highlightedCodeBlocks !== expectedStats.highlightedCodeBlocks) {
      throw new Error(`代码高亮块数量不一致：${diagnostics.highlightedCodeBlocks}/${expectedStats.highlightedCodeBlocks}`);
    }
    if (diagnostics.overflow.length) {
      console.warn(`警告：检测到 ${diagnostics.overflow.length} 个可能横向溢出的元素`);
      for (const item of diagnostics.overflow.slice(0, 5)) console.warn(`  ${item.tag}: ${item.text}`);
    }

    await page.emulateMediaType('print');
    await page.pdf({
      path: tempPdf,
      format: CONFIG.page.format,
      margin: CONFIG.page.margin,
      printBackground: true,
      displayHeaderFooter: options.headerFooter === 'on',
      headerTemplate: `<div style="font-size:8pt;color:#64748b;width:100%;text-align:center;padding:0 40px;">${escapeHtml(title)}</div>`,
      footerTemplate: '<div style="font-size:8pt;color:#64748b;width:100%;text-align:center;padding:0 40px;">第 <span class="pageNumber"></span> / <span class="totalPages"></span> 页</div>',
      preferCSSPageSize: true,
    });
    if (!existsSync(tempPdf) || statSync(tempPdf).size === 0) throw new Error('Puppeteer 未生成有效 PDF');

    const sourceForFinal = options.watermark || options.ownerPasswordEnv ? processedPdf : tempPdf;
    if (sourceForFinal === processedPdf) postprocessPdf(tempPdf, processedPdf, options);
    const finalized = finalizePdf(sourceForFinal, outputPath);
    return {
      ...finalized,
      bytes: statSync(finalized.path).size,
      svgCount: diagnostics.svgCount,
      mermaidCount: diagnostics.mermaidCount,
      internalLinkCount: diagnostics.internalLinkCount,
      highlightedCodeBlocks: diagnostics.highlightedCodeBlocks,
      highlightTokenCount: diagnostics.highlightTokenCount,
      overflowWarnings: diagnostics.overflow,
    };
  } finally {
    if (browser) await browser.close();
    await new Promise((resolvePromise) => server.close(resolvePromise));
    for (const temporary of [tempPdf, processedPdf]) {
      if (existsSync(temporary)) {
        try { unlinkSync(temporary); } catch { /* best effort */ }
      }
    }
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    printUsage();
    return;
  }
  if (parsed.positional.length === 0) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const inputPath = resolve(parsed.positional[0]);
  if (!existsSync(inputPath) || !statSync(inputPath).isFile()) throw new Error(`文件不存在：${inputPath}`);
  if (extname(inputPath).toLowerCase() !== '.md') throw new Error(`输入文件必须是 .md：${inputPath}`);

  const sourceStatBefore = statSync(inputPath);
  const source = readFileSync(inputPath, 'utf8');
  const title = extractTitle(source, inputPath);
  const prepared = prepareMarkdown(source, parsed.options);

  let outputPath;
  if (parsed.positional[1]) {
    outputPath = resolve(parsed.positional[1]);
  } else {
    const outputDir = parsed.options.dateFolder ? join(dirname(inputPath), todayLocal()) : dirname(inputPath);
    outputPath = join(outputDir, `${basename(inputPath, extname(inputPath))}.pdf`);
  }
  if (extname(outputPath).toLowerCase() !== '.pdf') throw new Error(`输出文件必须是 .pdf：${outputPath}`);

  console.log(`读取文件：${inputPath}`);
  console.log(`文档标题：${title}`);
  console.log(`文档行数：${prepared.stats.lineCount}`);
  console.log(`标题：${prepared.stats.headingCount} 个`);
  console.log(`围栏代码：${prepared.stats.fencedBlockCount} 个`);
  console.log(`Mermaid：${prepared.stats.mermaidCount} 个`);
  console.log(`公式：块级 ${prepared.stats.displayMathCount} 个，行内 ${prepared.stats.inlineMathCount} 个`);
  console.log(`目录：${prepared.stats.tocPresent ? (prepared.stats.tocAdded ? '已临时添加' : '已有') : '无'}`);
  if (prepared.stats.repairCount) console.log(`Markdown 安全修复：${prepared.stats.repairCount} 行`);
  if (prepared.stats.remainingStrongSpacing.length) {
    console.warn(`警告：仍有 ${prepared.stats.remainingStrongSpacing.length} 行疑似加粗空格问题，请结合原文检查`);
  }

  const nonce = crypto.randomBytes(16).toString('base64');
  const generated = generateHtml(prepared, title, parsed.options, nonce);
  const renderStats = { ...prepared.stats, ...generated.highlightStats };
  console.log(`代码高亮：${generated.highlightStats.highlightedCodeBlocks}/${generated.highlightStats.codeBlockCount} 个代码块`);
  if (generated.highlightStats.autoDetectedCodeBlocks) {
    console.log(`自动识别语言：${generated.highlightStats.autoDetectedCodeBlocks} 个代码块`);
  }
  if (generated.highlightStats.unknownLanguages.length) {
    console.warn(`警告：未识别的代码语言将按纯文本渲染：${generated.highlightStats.unknownLanguages.join(', ')}`);
  }
  console.log('正在生成 PDF...');
  const result = await generatePdf(generated.html, inputPath, outputPath, title, parsed.options, renderStats);

  const sourceStatAfter = statSync(inputPath);
  if (sourceStatAfter.size !== sourceStatBefore.size || sourceStatAfter.mtimeMs !== sourceStatBefore.mtimeMs) {
    throw new Error('源 Markdown 在转换期间发生变化，已停止交付，请重新执行');
  }

  console.log('\nPDF 生成成功');
  console.log(`输出文件：${result.path}`);
  console.log(`文件大小：${result.bytes} bytes`);
  console.log(`Mermaid SVG：${result.svgCount}/${result.mermaidCount}`);
  console.log(`公式：${prepared.stats.displayMathCount + prepared.stats.inlineMathCount} 个`);
  console.log(`目录内部链接：${result.internalLinkCount} 个`);
  console.log(`代码高亮：${result.highlightedCodeBlocks} 个代码块，${result.highlightTokenCount} 个着色片段`);
  console.log(`水印：${parsed.options.watermark ? parsed.options.watermark : '无'}`);
  console.log(`加密：${parsed.options.ownerPasswordEnv ? 'AES-256 所有者密码' : '无'}`);
  if (result.warning) console.warn(result.warning);
}

main().catch((error) => {
  console.error(`错误：${error.message || error}`);
  process.exit(1);
});
