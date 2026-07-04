/**
 * Cells — `defineModels` registry graph over the real HTTP surface.
 *
 * The adapter legs mount a circular authors↔articles pair authored with NO
 * hand-supplied relation `schema`/`table`: the factory auto-populates both
 * from the sibling entries and rewrites the friendly registry keys to the
 * physical table names. These cells are the ratchet for the adoption-time
 * behavior flips:
 *
 *  1. `?include=` resolves related rows — on drizzle via the AUTO-POPULATED
 *     relation `table` (previously a silent no-op without the hand-copied
 *     table ref), on memory via the rewritten model string.
 *  2. The OpenAPI document carries the include shapes built from the
 *     auto-populated schemas (previously omitted when `schema` was absent).
 *  3. Nested-write request bodies VALIDATE against the auto-populated sibling
 *     base schema (previously passed through unvalidated when `schema` was
 *     absent) — exact 400 VALIDATION_ERROR envelope on violation.
 *
 * The factory's own setup-time contract (aggregated loud unknown-target Error,
 * `onUnknownModel: 'ignore'`, `external: true`) is adapter-agnostic and pinned
 * by the core unit suite (tests/model-registry.test.ts), not repeated here.
 *
 * Skipped (named) on the prisma leg: its fixed examples schema has no registry
 * tables, so the graph is not mounted.
 */
import { expect, test } from 'vitest';
import {
  type AdapterDescriptor,
  type ConformanceRecord,
  type CtxGetter,
  createRecord,
  expectError,
  expectSuccess,
  jsonInit,
  readJson,
} from '../contract';

/** A wired author/article row as returned over HTTP (registry graph). */
type RegistryRecord = Record<string, unknown> & { id: string };

export function registerModelRegistryCells(descriptor: AdapterDescriptor, ctx: CtxGetter): void {
  const titles = {
    include: 'model registry: ?include resolves relations with no hand-supplied schema/table',
    openapi: 'model registry: OpenAPI documents include shapes from auto-populated schemas',
    nested:
      'model registry: nested-write bodies validate against the auto-populated sibling schema',
  };

  if (!descriptor.capabilities.modelRegistry) {
    for (const title of Object.values(titles)) {
      test.skip(`${title} [skipped: ${descriptor.name} leg mounts no defineModels graph]`, () => {});
    }
    return;
  }

  test(titles.include, async () => {
    const { app } = ctx();

    const author = await createRecord(app, '/registry-authors', {
      name: 'Ada',
      email: 'registry-ada@conformance.test',
    });
    const article = await expectSuccess<RegistryRecord>(
      await app.request(
        '/registry-articles',
        jsonInit('POST', { title: 'On Engines', authorId: author.id }),
      ),
      201,
    );

    // belongsTo include — drizzle resolves via the auto-populated relation
    // `table` (the F4 flip: previously a silent no-op), memory via the
    // rewritten 'registry_authors' model string.
    const withAuthor = await expectSuccess<RegistryRecord>(
      await app.request(`/registry-articles/${article.id}?include=author`),
      200,
    );
    expect(withAuthor.author).toMatchObject({ id: author.id, name: 'Ada' });

    // hasMany include on the other side of the circular pair.
    const withArticles = await expectSuccess<RegistryRecord>(
      await app.request(`/registry-authors/${author.id}?include=articles`),
      200,
    );
    expect(withArticles.articles).toEqual([
      expect.objectContaining({ id: article.id, title: 'On Engines' }),
    ]);
  });

  test(titles.openapi, async () => {
    const { app } = ctx();

    const response = await app.request('/openapi.json');
    expect(response.status).toBe(200);
    const document = await readJson<{ paths: Record<string, unknown> }>(response);

    // The Read operations' response schemas embed the includable relation
    // fields built by withIncludableRelations from the AUTO-POPULATED schemas.
    // Asserted on the serialized operation subtree to stay agnostic to
    // $ref/inline emission details.
    const authorRead = JSON.stringify(document.paths['/registry-authors/{id}'] ?? {});
    expect(authorRead).toContain('"articles"');
    const articleRead = JSON.stringify(document.paths['/registry-articles/{id}'] ?? {});
    expect(articleRead).toContain('"author"');
  });

  test(titles.nested, async () => {
    const { app } = ctx();

    // A nested article violating the sibling base schema (title must be a
    // string) is rejected with the exact validation envelope — before the
    // registry, a schema-less nested-writable relation passed through
    // unvalidated.
    await expectError(
      await app.request(
        '/registry-authors',
        jsonInit('POST', {
          name: 'Bad Nest',
          email: 'registry-bad-nest@conformance.test',
          articles: [{ title: 123 }],
        }),
      ),
      400,
      'VALIDATION_ERROR',
    );

    // A valid nested article is created and linked (FK auto-set).
    const created = await expectSuccess<ConformanceRecord>(
      await app.request(
        '/registry-authors',
        jsonInit('POST', {
          name: 'Nia',
          email: 'registry-nia@conformance.test',
          articles: [{ title: 'Nested!' }],
        }),
      ),
      201,
    );
    const read = await expectSuccess<RegistryRecord>(
      await app.request(`/registry-authors/${created.id}?include=articles`),
      200,
    );
    expect(read.articles).toEqual([expect.objectContaining({ title: 'Nested!' })]);
  });
}
