// Unit tests for `defineModels` (packages/core/src/core/model-registry.ts) —
// the eager registry factory that lets models reference each other by sibling
// key (circular graphs included), auto-populates each relation's `schema` /
// `table` from its target sibling, and rewrites the authored registry key to
// the target's `tableName` for the adapters.
import type { MetaInput, Model, RelationConfig } from 'hono-crud';
import { defineMeta, defineModels, defineModelsExtending } from 'hono-crud';
import { withIncludableRelations } from 'hono-crud/internal';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const UserSchema = z.object({ id: z.string(), name: z.string(), email: z.string() });
const PostSchema = z.object({ id: z.string(), title: z.string(), authorId: z.string() });

/** Fresh circular User↔Post input map per test (guards the no-mutation contract). */
function circularInput() {
  return {
    users: {
      tableName: 'users',
      schema: UserSchema,
      primaryKeys: ['id'] as ['id'],
      relations: {
        posts: { type: 'hasMany', model: 'posts', foreignKey: 'authorId' },
      },
    },
    posts: {
      tableName: 'posts',
      schema: PostSchema,
      primaryKeys: ['id'] as ['id'],
      relations: {
        author: { type: 'belongsTo', model: 'users', foreignKey: 'authorId' },
      },
    },
  } as const;
}

describe('defineModels', () => {
  it('wires a circular User↔Post graph, auto-populating relation schemas from siblings', () => {
    const db = defineModels(circularInput());

    expect(db.users.relations?.posts.schema).toBe(PostSchema);
    expect(db.posts.relations?.author.schema).toBe(UserSchema);
  });

  it('auto-populates relation.table from the sibling Model.table object (and leaves it undefined when the sibling has none)', () => {
    const usersTable = { _: { name: 'users', columns: {} } };
    const postsTable = { _: { name: 'posts', columns: {} } };
    const db = defineModels({
      users: {
        tableName: 'users',
        schema: UserSchema,
        primaryKeys: ['id'],
        table: usersTable,
        relations: { posts: { type: 'hasMany', model: 'posts', foreignKey: 'authorId' } },
      },
      posts: {
        tableName: 'posts',
        schema: PostSchema,
        primaryKeys: ['id'],
        table: postsTable,
        relations: { author: { type: 'belongsTo', model: 'users', foreignKey: 'authorId' } },
      },
    });

    // The exact same object reference the sibling model holds — what drizzle needs.
    expect(db.users.relations?.posts.table).toBe(postsTable);
    expect(db.posts.relations?.author.table).toBe(usersTable);

    const memory = defineModels(circularInput());
    expect(memory.users.relations?.posts.table).toBeUndefined();
  });

  it('rewrites relation.model from the registry key to the sibling tableName', () => {
    const db = defineModels({
      people: {
        // Friendly registry key differing from the physical table name.
        tableName: 'persons',
        schema: UserSchema,
        primaryKeys: ['id'],
      },
      posts: {
        tableName: 'posts',
        schema: PostSchema,
        primaryKeys: ['id'],
        relations: { author: { type: 'belongsTo', model: 'people', foreignKey: 'authorId' } },
      },
    });

    expect(db.posts.relations?.author.model).toBe('persons');
    // Inert when key === tableName.
    const same = defineModels(circularInput());
    expect(same.users.relations?.posts.model).toBe('posts');
  });

  it('keeps explicitly-authored schema/table by default (author wins)', () => {
    const ExplicitSchema = z.object({ id: z.string() });
    const explicitTable = { _: { name: 'posts_explicit', columns: {} } };
    const db = defineModels({
      users: {
        tableName: 'users',
        schema: UserSchema,
        primaryKeys: ['id'],
        relations: {
          posts: {
            type: 'hasMany',
            model: 'posts',
            foreignKey: 'authorId',
            schema: ExplicitSchema,
            table: explicitTable,
          },
        },
      },
      posts: { tableName: 'posts', schema: PostSchema, primaryKeys: ['id'] },
    });

    expect(db.users.relations?.posts.schema).toBe(ExplicitSchema);
    expect(db.users.relations?.posts.table).toBe(explicitTable);
  });

  it('overwriteExplicit: true replaces explicitly-authored schema/table with sibling values', () => {
    const ExplicitSchema = z.object({ id: z.string() });
    const db = defineModels(
      {
        users: {
          tableName: 'users',
          schema: UserSchema,
          primaryKeys: ['id'],
          relations: {
            posts: {
              type: 'hasMany',
              model: 'posts',
              foreignKey: 'authorId',
              schema: ExplicitSchema,
            },
          },
        },
        posts: { tableName: 'posts', schema: PostSchema, primaryKeys: ['id'] },
      },
      { overwriteExplicit: true },
    );

    expect(db.users.relations?.posts.schema).toBe(PostSchema);
  });

  it('autoPopulateSchema/autoPopulateTable: false disable population', () => {
    const postsTable = { _: { name: 'posts', columns: {} } };
    const db = defineModels(
      {
        users: {
          tableName: 'users',
          schema: UserSchema,
          primaryKeys: ['id'],
          relations: { posts: { type: 'hasMany', model: 'posts', foreignKey: 'authorId' } },
        },
        posts: {
          tableName: 'posts',
          schema: PostSchema,
          primaryKeys: ['id'],
          table: postsTable,
        },
      },
      { autoPopulateSchema: false, autoPopulateTable: false },
    );

    expect(db.users.relations?.posts.schema).toBeUndefined();
    expect(db.users.relations?.posts.table).toBeUndefined();
    // The key→tableName rewrite still happens — it is wiring, not population.
    expect(db.users.relations?.posts.model).toBe('posts');
  });

  it('throws ONE aggregated plain Error listing every unknown internal target, with a suggestion', () => {
    let caught: unknown;
    try {
      defineModels({
        users: {
          tableName: 'users',
          schema: UserSchema,
          primaryKeys: ['id'],
          relations: {
            // @ts-expect-error - deliberately unknown sibling key (runtime path under test)
            posts: { type: 'hasMany', model: 'postz', foreignKey: 'authorId' },
            // @ts-expect-error - deliberately unknown sibling key (runtime path under test)
            avatar: { type: 'hasOne', model: 'nope', foreignKey: 'userId' },
          },
        },
        posts: { tableName: 'posts', schema: PostSchema, primaryKeys: ['id'] },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    // Setup-time factory validation → plain Error, per the error-split doctrine.
    expect((caught as Error).constructor).toBe(Error);
    const message = (caught as Error).message;
    // Both misses aggregated into the one throw.
    expect(message).toContain("'postz'");
    expect(message).toContain("'nope'");
    // Levenshtein suggestion for the near-miss.
    expect(message.toLowerCase()).toContain("did you mean 'posts'");
  });

  it("onUnknownModel: 'ignore' leaves unknown targets unresolved without throwing", () => {
    const db = defineModels(
      {
        users: {
          tableName: 'users',
          schema: UserSchema,
          primaryKeys: ['id'],
          relations: {
            // @ts-expect-error - deliberately unknown sibling key (runtime path under test)
            posts: { type: 'hasMany', model: 'postz', foreignKey: 'authorId' },
          },
        },
      },
      { onUnknownModel: 'ignore' },
    );

    expect(db.users.relations?.posts.model).toBe('postz');
    expect(db.users.relations?.posts.schema).toBeUndefined();
  });

  it('external: true skips sibling checking + auto-population and strips the marker', () => {
    const OrgSchema = z.object({ id: z.string(), name: z.string() });
    const db = defineModels({
      users: {
        tableName: 'users',
        schema: UserSchema,
        primaryKeys: ['id'],
        relations: {
          org: {
            type: 'belongsTo',
            model: 'organizations',
            foreignKey: 'orgId',
            external: true,
            schema: OrgSchema,
          },
        },
      },
    });

    const org = db.users.relations?.org as RelationConfig;
    expect(org.model).toBe('organizations');
    expect(org.schema).toBe(OrgSchema);
    expect('external' in org).toBe(false);
  });

  it('never mutates the author input map', () => {
    const input = circularInput();
    const inputPostsRelation = input.users.relations.posts;

    const db = defineModels(input);

    expect(inputPostsRelation).toEqual({
      type: 'hasMany',
      model: 'posts',
      foreignKey: 'authorId',
    });
    expect(db.users.relations?.posts).not.toBe(inputPostsRelation);
    expect(db.users).not.toBe(input.users);
  });

  it('freeze: true freezes the wired models and their relation configs', () => {
    const db = defineModels(circularInput(), { freeze: true });

    expect(Object.isFrozen(db.users)).toBe(true);
    expect(Object.isFrozen(db.users.relations)).toBe(true);
    expect(Object.isFrozen(db.users.relations?.posts)).toBe(true);
  });

  it('passes relation-less entries through with their config intact', () => {
    const db = defineModels({
      bare: { tableName: 'bare', schema: UserSchema, primaryKeys: ['id'] },
    });

    expect(db.bare.tableName).toBe('bare');
    expect(db.bare.schema).toBe(UserSchema);
    expect(db.bare.primaryKeys).toEqual(['id']);
    expect(db.bare.relations).toBeUndefined();
  });

  it('preserves loader-facing relation fields (type/foreignKey/localKey/cascade/scope) untouched', () => {
    const db = defineModels({
      users: {
        tableName: 'users',
        schema: UserSchema,
        primaryKeys: ['id'],
        relations: {
          posts: {
            type: 'hasMany',
            model: 'posts',
            foreignKey: 'authorId',
            localKey: 'id',
            cascade: { onDelete: 'cascade' },
            scope: { tenantField: 'tenantId', softDeleteField: 'deletedAt' },
          },
        },
      },
      posts: { tableName: 'posts', schema: PostSchema, primaryKeys: ['id'] },
    });

    const posts = db.users.relations?.posts as RelationConfig;
    expect(posts.type).toBe('hasMany');
    expect(posts.foreignKey).toBe('authorId');
    expect(posts.localKey).toBe('id');
    expect(posts.cascade).toEqual({ onDelete: 'cascade' });
    expect(posts.scope).toEqual({ tenantField: 'tenantId', softDeleteField: 'deletedAt' });
  });

  it('closes the OpenAPI include gap: wired meta feeds withIncludableRelations without hand-supplied schemas', () => {
    const db = defineModels(circularInput());
    const meta: MetaInput = defineMeta({ model: db.users });

    const extended = withIncludableRelations(UserSchema, meta, ['posts']);

    expect(Object.keys(extended.shape)).toContain('posts');
  });

  it('wired models remain plain Model objects (wide-assignable, enumerable relations)', () => {
    const db = defineModels(circularInput());
    const models: Model[] = [db.users, db.posts];

    expect(models).toHaveLength(2);
    expect(Object.keys(db.users.relations ?? {})).toEqual(['posts']);
  });
});

describe('defineModelsExtending', () => {
  it('resolves relations against the base map: schema/table auto-populated, key rewritten to the base tableName', () => {
    const tenantsTable = { _: { name: 'tenant_rows', columns: {} } };
    const base = defineModels({
      tenants: {
        // Friendly base key differing from the physical table name.
        tableName: 'tenant_rows',
        schema: UserSchema,
        primaryKeys: ['id'],
        table: tenantsTable,
      },
    });

    const extended = defineModelsExtending(
      {
        projects: {
          tableName: 'projects',
          schema: PostSchema,
          primaryKeys: ['id'],
          relations: {
            tenant: { type: 'belongsTo', model: 'tenants', foreignKey: 'authorId' },
          },
        },
      },
      { extends: base },
    );

    expect(extended.projects.relations?.tenant.schema).toBe(UserSchema);
    expect(extended.projects.relations?.tenant.table).toBe(tenantsTable);
    expect(extended.projects.relations?.tenant.model).toBe('tenant_rows');
  });

  it('returns the base entries alongside the new ones, without re-wiring or replacing them', () => {
    const base = defineModels(circularInput());
    const baseUsers = base.users;

    const extended = defineModelsExtending(
      {
        tags: { tableName: 'tags', schema: PostSchema, primaryKeys: ['id'] },
      },
      { extends: base },
    );

    expect(extended.users).toBe(baseUsers);
    expect(extended.tags.tableName).toBe('tags');
  });

  it('new entries can also reference each other (same-call siblings win over base keys)', () => {
    const base = defineModels({
      posts: { tableName: 'base_posts', schema: PostSchema, primaryKeys: ['id'] },
    });

    const extended = defineModelsExtending(
      {
        users: {
          tableName: 'users',
          schema: UserSchema,
          primaryKeys: ['id'],
          relations: { posts: { type: 'hasMany', model: 'posts', foreignKey: 'authorId' } },
        },
        posts: { tableName: 'new_posts', schema: PostSchema, primaryKeys: ['id'] },
      },
      { extends: base },
    );

    // The same-call sibling shadows the base entry of the same key.
    expect(extended.users.relations?.posts.model).toBe('new_posts');
  });

  it('aggregates unknown targets across BOTH keyspaces into one plain Error', () => {
    const base = defineModels({
      tenants: { tableName: 'tenants', schema: UserSchema, primaryKeys: ['id'] },
    });

    let caught: unknown;
    try {
      defineModelsExtending(
        {
          projects: {
            tableName: 'projects',
            schema: PostSchema,
            primaryKeys: ['id'],
            relations: {
              // @ts-expect-error - deliberately unknown key across both maps (runtime path)
              tenant: { type: 'belongsTo', model: 'tenantz', foreignKey: 'authorId' },
            },
          },
        },
        { extends: base },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).constructor).toBe(Error);
    const message = (caught as Error).message;
    expect(message).toContain("'tenantz'");
    expect(message.toLowerCase()).toContain("did you mean 'tenants'");
    // Known keys list spans base + new.
    expect(message).toContain('tenants');
    expect(message).toContain('projects');
  });

  it('honors the DefineModelsConfig knobs and freezes only the NEW models', () => {
    const base = defineModels({
      tenants: { tableName: 'tenants', schema: UserSchema, primaryKeys: ['id'] },
    });

    const extended = defineModelsExtending(
      {
        projects: {
          tableName: 'projects',
          schema: PostSchema,
          primaryKeys: ['id'],
          relations: {
            tenant: { type: 'belongsTo', model: 'tenants', foreignKey: 'authorId' },
          },
        },
      },
      { extends: base, autoPopulateSchema: false, freeze: true },
    );

    expect(extended.projects.relations?.tenant.schema).toBeUndefined();
    expect(extended.projects.relations?.tenant.model).toBe('tenants');
    expect(Object.isFrozen(extended.projects)).toBe(true);
    // The base map was returned to its own consumers unwired — never frozen here.
    expect(Object.isFrozen(extended.tenants)).toBe(false);
  });
});
