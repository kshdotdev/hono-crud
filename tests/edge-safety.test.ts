import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const srcRoot = join(repoRoot, 'src');

function listSourceFiles(): string[] {
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        visit(fullPath);
      } else if (entry.endsWith('.ts')) {
        files.push(fullPath);
      }
    }
  };
  visit(srcRoot);
  return files;
}

function stripCommentsAndStrings(source: string): string {
  let result = '';
  let index = 0;
  let state: 'code' | 'line-comment' | 'block-comment' | 'single' | 'double' | 'template' = 'code';

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (state === 'code') {
      if (char === '/' && next === '/') {
        state = 'line-comment';
        result += '  ';
        index += 2;
        continue;
      }
      if (char === '/' && next === '*') {
        state = 'block-comment';
        result += '  ';
        index += 2;
        continue;
      }
      if (char === "'") state = 'single';
      if (char === '"') state = 'double';
      if (char === '`') state = 'template';
      result += state === 'code' ? char : ' ';
      index++;
      continue;
    }

    if (state === 'line-comment') {
      result += char === '\n' ? '\n' : ' ';
      if (char === '\n') state = 'code';
      index++;
      continue;
    }

    if (state === 'block-comment') {
      result += char === '\n' ? '\n' : ' ';
      if (char === '*' && next === '/') {
        result += ' ';
        index += 2;
        state = 'code';
      } else {
        index++;
      }
      continue;
    }

    const quoteState = state;
    result += char === '\n' ? '\n' : ' ';
    if (char === '\\') {
      result += next === '\n' ? '\n' : ' ';
      index += 2;
      continue;
    }
    if (
      (quoteState === 'single' && char === "'") ||
      (quoteState === 'double' && char === '"') ||
      (quoteState === 'template' && char === '`')
    ) {
      state = 'code';
    }
    index++;
  }

  return result;
}

describe('edge safety static scan', () => {
  it('does not import banned Node.js modules from shipped source', () => {
    const bannedModules = [
      'fs', 'path', 'os', 'child_process', 'net', 'http', 'https', 'dgram',
      'cluster', 'worker_threads', 'vm', 'tls', 'dns', 'readline', 'crypto', 'module',
    ];
    const importPattern = new RegExp(
      String.raw`(?:from\s+['"](?:node:)?(?:${bannedModules.join('|')})['"]|import\s*\(\s*['"](?:node:)?(?:${bannedModules.join('|')})['"]\s*\))`
    );

    const offenders = listSourceFiles().filter((file) => importPattern.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('does not use banned runtime globals or broad type escapes in shipped source', () => {
    const patterns: Array<[string, RegExp]> = [
      ['Buffer', /\bBuffer\b/],
      ['process', /\bprocess\b/],
      ['require', /\brequire\s*\(/],
      ['createRequire', /\bcreateRequire\b/],
      ['setInterval', /\bsetInterval\s*\(/],
      ['global mutable state', /\bglobalThis\b|\bglobal\b/],
      ['eval', /(^|[^\w.])eval\s*\(/],
      ['new Function', /\bnew\s+Function\b/],
      ['z.any()', /\bz\.any\s*\(/],
      ['as Function', /\bas\s+Function\b/],
    ];

    const offenders: string[] = [];
    for (const file of listSourceFiles()) {
      const source = stripCommentsAndStrings(readFileSync(file, 'utf8'));
      for (const [label, pattern] of patterns) {
        if (pattern.test(source)) {
          offenders.push(`${file}: ${label}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
