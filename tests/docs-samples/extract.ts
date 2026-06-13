/**
 * Docs sample extractor — the "docs truth" ratchet.
 *
 * Scans every markdown doc that ships code samples (root README, package
 * READMEs, docs/ guides), extracts each fenced ```ts / ```typescript block
 * into `.generated/<slug>.L<line>.ts`, and lets `tsc -p tests/docs-samples`
 * typecheck them against the BUILT packages. Because the root package.json
 * depends on every workspace package (`hono-crud`, `@hono-crud/*`), module
 * resolution goes through the real `exports` maps to `dist/` types — so a
 * sample importing a symbol that is no longer on the root barrel (or a
 * subpath that does not exist) fails the build, exactly like it would for
 * a consumer.
 *
 * Markers (placed on the nearest non-blank line above a fence):
 * - `<!-- docs-typecheck:skip <reason> -->` — exclude the block. Use
 *   sparingly: a skipped sample is an unverified sample. Reserve it for
 *   intentionally-broken pseudo-code and samples requiring SDKs that are
 *   not installed in this repo.
 * - `<!-- docs-typecheck:prelude -->` — the block is typechecked on its
 *   own AND prepended to every later block in the same document, so a
 *   guide can establish shared setup (schemas, tables, models) once and
 *   keep subsequent samples focused. Preludes accumulate in order.
 *
 * This file is build tooling, not library source — Node APIs are fine here.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = join(repoRoot, 'tests/docs-samples/.generated');

/** Markdown files whose ```ts blocks must typecheck. */
function collectMarkdownFiles(): string[] {
  const files = [join(repoRoot, 'README.md')];
  for (const entry of readdirSync(join(repoRoot, 'docs'))) {
    if (entry.endsWith('.md')) files.push(join(repoRoot, 'docs', entry));
  }
  for (const pkg of readdirSync(join(repoRoot, 'packages'))) {
    const readme = join(repoRoot, 'packages', pkg, 'README.md');
    try {
      readFileSync(readme);
      files.push(readme);
    } catch {
      // package without a README — nothing to check
    }
  }
  return files;
}

const SKIP_MARKER = '<!-- docs-typecheck:skip';
const PRELUDE_MARKER = '<!-- docs-typecheck:prelude';
const TS_FENCE = /^```(?:ts|typescript)\b/;

interface Sample {
  sourceFile: string;
  startLine: number;
  code: string;
}

function extractSamples(file: string): { samples: Sample[]; skipped: number } {
  const lines = readFileSync(file, 'utf8').split('\n');
  const samples: Sample[] = [];
  const preludes: string[] = [];
  let skipped = 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (TS_FENCE.test(line.trim())) {
      const prev = lines
        .slice(0, i)
        .reverse()
        .find((l) => l.trim() !== '');
      const marker = prev?.trim();
      const isSkipped = marker?.startsWith(SKIP_MARKER) ?? false;
      const isPrelude = marker?.startsWith(PRELUDE_MARKER) ?? false;
      const start = i + 1;
      const body: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '```') {
        body.push(lines[i]);
        i++;
      }
      if (isSkipped) {
        skipped++;
      } else {
        const code = [...preludes, body.join('\n')].join('\n\n');
        samples.push({ sourceFile: file, startLine: start, code });
        if (isPrelude) preludes.push(body.join('\n'));
      }
    }
    i++;
  }
  return { samples, skipped };
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

let total = 0;
let totalSkipped = 0;
for (const file of collectMarkdownFiles()) {
  const { samples, skipped } = extractSamples(file);
  totalSkipped += skipped;
  for (const sample of samples) {
    const rel = relative(repoRoot, sample.sourceFile);
    const slug = rel.replace(/\.md$/, '').replace(/[^a-zA-Z0-9]+/g, '_');
    const name = `${slug}.L${String(sample.startLine).padStart(4, '0')}.ts`;
    // `export {}` forces module scope so samples never collide with each
    // other (or with ambient globals) even when they contain no imports.
    const content = `// extracted from ${rel}:${sample.startLine} — do not edit; fix the doc.\n${sample.code}\n\nexport {};\n`;
    writeFileSync(join(outDir, name), content);
    total++;
  }
}

console.log(`docs-samples: extracted ${total} sample(s) to ${relative(repoRoot, outDir)} (${totalSkipped} skipped)`);
