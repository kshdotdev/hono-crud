/**
 * Compile-time assertions for the typed-relations foundation.
 *
 * Checked by `pnpm run typecheck:types` (tsc only — this file is never
 * executed). Every `@ts-expect-error` line is a negative assertion: if the
 * rejection it documents stops firing, the typecheck fails, so the literal
 * typing cannot silently regress.
 */
import type { FieldsOf, MetaInput, Model, RelationNamesOf } from 'hono-crud';
import { defineMeta, defineModel } from 'hono-crud';
import { z } from 'zod';

const UserSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
});

// ============================================================================
// defineModel captures relation-name literals from plain object keys
// ============================================================================

const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
  relations: {
    posts: { type: 'hasMany', model: 'posts', foreignKey: 'authorId' },
    profile: { type: 'hasOne', model: 'profiles', foreignKey: 'userId' },
  },
});

const userMeta = defineMeta({ model: UserModel });

type UserRelationNames = RelationNamesOf<typeof userMeta>;
type UserFields = FieldsOf<typeof userMeta>;

// Positive: declared relation names and schema fields are accepted.
const posts: UserRelationNames = 'posts';
const profile: UserRelationNames = 'profile';
const email: UserFields = 'email';

// Negative: typos are compile errors.
// @ts-expect-error - 'psots' is not a declared relation name
const typoRelation: UserRelationNames = 'psots';
// @ts-expect-error - 'nope' is not a schema field
const typoField: UserFields = 'nope';

// ============================================================================
// primaryKeys stays literal-checked (pre-existing behavior must survive)
// ============================================================================

defineModel({
  tableName: 'users_pk_check',
  schema: UserSchema,
  // @ts-expect-error - 'bogus' is not a schema key
  primaryKeys: ['bogus'],
});

// ============================================================================
// Wide/default MetaInput degrades to permissive `string` (no rejections)
// ============================================================================

declare const wideMeta: MetaInput;
const wideRelation: RelationNamesOf<typeof wideMeta> = 'anything-goes';
const wideField: FieldsOf<typeof wideMeta> = 'whatever';

// A relation-less model also stays permissive (TRelationName falls back to
// its `string` default — absence is indistinguishable from wide by design).
const BareModel = defineModel({
  tableName: 'bare',
  schema: UserSchema,
  primaryKeys: ['id'],
});
const bareMeta = defineMeta({ model: BareModel });
const bareRelation: RelationNamesOf<typeof bareMeta> = 'any-name-compiles';

// ============================================================================
// Heterogeneous collections keep compiling (defaulted third generic)
// ============================================================================

const PostModel = defineModel({
  tableName: 'posts',
  schema: z.object({ id: z.uuid(), title: z.string() }),
  primaryKeys: ['id'],
});

// Narrowed models/metas assign to the wide existential forms used by
// registries and non-generic plumbing (the erasure zone).
const models: Model[] = [UserModel, PostModel, BareModel];
const metas: MetaInput[] = [userMeta, bareMeta, defineMeta({ model: PostModel })];

// Model<T> / Model<T, TTable> partial applications still accept narrowed values.
const modelT: Model<typeof UserSchema> = UserModel;
const modelTT: Model<typeof UserSchema, unknown> = UserModel;

// ============================================================================
// Keep the runtime-unused bindings referenced so tsc's noUnusedLocals-off
// examples config never flags them and bundler tree-shake analysis is happy.
// ============================================================================

export {
  posts,
  profile,
  email,
  typoRelation,
  typoField,
  wideRelation,
  wideField,
  bareRelation,
  models,
  metas,
  modelT,
  modelTT,
};

// ============================================================================
// F2 — authoring surfaces constrain relation names (builder / functional /
// config). Parameter positions only; nothing narrows past `.build()`.
// ============================================================================

import { crud } from 'hono-crud/builder';
import type { EndpointsConfig } from 'hono-crud/config';
import type { ListConfig, ReadConfig } from 'hono-crud/functional';

// Builder: declared relation names accepted, typos rejected.
crud(userMeta).list().include('posts', 'profile');
crud(userMeta).read().include('profile');
crud(userMeta).create().nestedCreate('posts');
crud(userMeta).update().nestedWrites('posts');

// @ts-expect-error - 'psots' is not a declared relation name
crud(userMeta).list().include('psots');
// @ts-expect-error - 'author' is not declared on UserModel
crud(userMeta).read().include('author');
// @ts-expect-error - typo'd nested-create relation
crud(userMeta).create().nestedCreate('psots');
// @ts-expect-error - typo'd nested-writes relation
crud(userMeta).update().nestedWrites('profiel');

// Wide meta stays permissive through the builder.
crud(wideMeta).list().include('anything-goes');

// Functional config bags.
const listCfg: ListConfig<typeof userMeta> = {
  meta: userMeta,
  allowedIncludes: ['posts'],
};
const readCfg: ReadConfig<typeof userMeta> = {
  meta: userMeta,
  // @ts-expect-error - typo'd include in functional config
  allowedIncludes: ['psots'],
};

// Config-object API.
const endpointsCfg: EndpointsConfig<typeof userMeta> = {
  meta: userMeta,
  list: { includes: ['posts', 'profile'] },
  read: {
    // @ts-expect-error - typo'd include in config API
    includes: ['profil'],
  },
  create: { nestedCreate: ['posts'] },
  update: {
    // @ts-expect-error - typo'd nested-writes relation in config API
    nestedWrites: ['psots'],
  },
};

export { listCfg, readCfg, endpointsCfg };

// ============================================================================
// F3 — model field arrays are schema-key-checked on defineModel
// ============================================================================

import type { ComputedFieldReturns, ComputedFieldsConfig } from 'hono-crud';

defineModel({
  tableName: 'field_checks',
  schema: UserSchema,
  primaryKeys: ['id'],
  softDelete: { field: 'email' }, // any real schema key is accepted
  multiTenant: { field: 'id' },
  timestamps: false,
  audit: { excludeFields: ['email', 'name'] },
  versioning: { field: 'id', excludeFields: ['email'], historyTable: 'anything_free' },
  computedFields: {
    displayName: {
      compute: (u) => u.name.toUpperCase(),
      dependsOn: ['name'],
    },
  },
});

defineModel({
  tableName: 'field_checks_bad_softdelete',
  schema: UserSchema,
  primaryKeys: ['id'],
  // @ts-expect-error - 'removedAt' is not a schema key
  softDelete: { field: 'removedAt' },
});

defineModel({
  tableName: 'field_checks_bad_audit',
  schema: UserSchema,
  primaryKeys: ['id'],
  // @ts-expect-error - 'password' is not a schema key
  audit: { excludeFields: ['password'] },
});

defineModel({
  tableName: 'field_checks_bad_tenant',
  schema: UserSchema,
  primaryKeys: ['id'],
  // @ts-expect-error - 'orgId' is not a schema key
  multiTenant: { field: 'orgId' },
});

defineModel({
  tableName: 'field_checks_bad_timestamps',
  schema: UserSchema,
  primaryKeys: ['id'],
  // @ts-expect-error - 'created' is not a schema key
  timestamps: { createdAt: 'created' },
});

defineModel({
  tableName: 'field_checks_bad_depends',
  schema: UserSchema,
  primaryKeys: ['id'],
  computedFields: {
    displayName: {
      compute: (u: { name: string }) => u.name,
      // @ts-expect-error - 'fullName' is not a record key
      dependsOn: ['fullName'],
    },
  },
});

// The documented reuse cliff: a bare-annotated sub-config widens to string
// and no longer assigns into a model slot — inline it, or annotate with the
// schema-key union.
import type { SoftDeleteConfig } from 'hono-crud';
const bareSoftDelete: SoftDeleteConfig = { field: 'deletedAt' };
defineModel({
  tableName: 'field_checks_cliff',
  schema: UserSchema,
  primaryKeys: ['id'],
  // @ts-expect-error - bare SoftDeleteConfig widened to string; see JSDoc
  softDelete: bareSoftDelete,
});

// The ComputedFieldsConfig<Row> reuse pattern from the repo's own examples
// must KEEP compiling (row-typed, not key-generic).
type UserRow = { id: string; name: string; email: string };
const reusedComputed: ComputedFieldsConfig<UserRow> = {
  displayName: { compute: (u) => u.name.toUpperCase(), dependsOn: ['name'] },
};
defineModel({
  tableName: 'field_checks_reuse',
  schema: UserSchema,
  primaryKeys: ['id'],
  computedFields: reusedComputed,
});

// Read-side helper maps computed names to awaited return types.
type Computed = ComputedFieldReturns<typeof reusedComputed>;
const computedName: Computed['displayName'] = 'X';

export { bareSoftDelete, reusedComputed, computedName };

// ============================================================================
// F4 — schema-field authoring params (builder / functional / config /
// aggregate class field)
// ============================================================================

crud(userMeta).list().filter('name', 'email').search('name').sortable('id').defaultSort('name');
crud(userMeta).update().allowedFields('name').blockedFields('email');

// @ts-expect-error - 'nope' is not a schema field
crud(userMeta).list().filter('nope');
// @ts-expect-error - typo'd search field
crud(userMeta).list().search('emial');
// @ts-expect-error - typo'd sortable field
crud(userMeta).list().sortable('nmae');
// @ts-expect-error - typo'd default-sort field
crud(userMeta).list().defaultSort('nmae');
// @ts-expect-error - typo'd allowed update field
crud(userMeta).update().allowedFields('nope');

// Functional list config field arrays.
const listFieldsCfg: ListConfig<typeof userMeta> = {
  meta: userMeta,
  filterFields: ['name'],
  searchFields: ['email'],
  sortFields: ['id'],
};
const listFieldsBad: ListConfig<typeof userMeta> = {
  meta: userMeta,
  // @ts-expect-error - typo'd filter field in functional config
  filterFields: ['nope'],
};

// Config-object API field bags.
const endpointsFieldsCfg: EndpointsConfig<typeof userMeta> = {
  meta: userMeta,
  list: {
    filtering: { fields: ['name'] },
    search: { fields: ['email'] },
    sorting: { fields: ['name'], default: 'name' },
  },
  update: { fields: { allowed: ['name'], blocked: ['email'] } },
  aggregate: { fields: ['id'] },
};
const endpointsFieldsBad: EndpointsConfig<typeof userMeta> = {
  meta: userMeta,
  list: {
    // @ts-expect-error - typo'd filtering field in config API
    filtering: { fields: ['nope'] },
  },
};

// Aggregate allow-lists are schema-checked via explicit annotation (the
// endpoint CLASS FIELD stays wide: property overrides get no contextual
// typing, so narrowing it would reject the documented
// `aggregateConfig = {...}` subclass pattern — pinned below).
import type { AggregateConfig } from 'hono-crud';
const aggOk: AggregateConfig<FieldsOf<typeof userMeta>> = { sumFields: ['id'] };
// @ts-expect-error - 'total' is not a schema field
const aggBad: AggregateConfig<FieldsOf<typeof userMeta>> = { sumFields: ['total'] };

// The documented subclass pattern keeps compiling (regression guard for the
// class-field revert).
import { MemoryAggregateEndpoint } from '@hono-crud/memory';
class SubclassAggregate extends MemoryAggregateEndpoint {
  _meta = userMeta;
  override aggregateConfig = { sumFields: ['name'] };
}
const subclassAggregate = new SubclassAggregate();

// Wide meta stays permissive on every field surface.
crud(wideMeta).list().filter('whatever').search('anything').sortable('x').defaultSort('y');

export {
  listFieldsCfg,
  listFieldsBad,
  endpointsFieldsCfg,
  endpointsFieldsBad,
  aggOk,
  aggBad,
  subclassAggregate,
};

// ============================================================================
// F5 — defineModels registry factory: sibling-key constraint, literal-key
// survival, variance guards, and the `external` escape hatch
// ============================================================================

import type { RelationConfig } from 'hono-crud';
import { defineModels } from 'hono-crud';

const RegistryPostSchema = z.object({ id: z.uuid(), title: z.string(), authorId: z.uuid() });

// Circular User↔Post inside ONE call — cross-references are sibling keys, so
// the cycle is inert data (no ordering, no thunks, no standalone-const games).
const registryDb = defineModels({
  users: {
    tableName: 'users',
    schema: UserSchema,
    primaryKeys: ['id'],
    relations: {
      posts: { type: 'hasMany', model: 'posts', foreignKey: 'authorId' },
    },
  },
  posts: {
    tableName: 'posts',
    schema: RegistryPostSchema,
    primaryKeys: ['id'],
    relations: {
      author: { type: 'belongsTo', model: 'users', foreignKey: 'authorId' },
    },
  },
});

const registryUserMeta = defineMeta({ model: registryDb.users });
const registryPostMeta = defineMeta({ model: registryDb.posts });

// P1 — literal relation-name keys survive the factory.
const registryRelOk: RelationNamesOf<typeof registryUserMeta> = 'posts';
const registryRelOk2: RelationNamesOf<typeof registryPostMeta> = 'author';
// @ts-expect-error - 'psots' is not a declared relation name
const registryRelBad: RelationNamesOf<typeof registryUserMeta> = 'psots';

// P4a — relation `model` is constrained to the sibling registry keys.
defineModels({
  solo: {
    tableName: 'solo',
    schema: UserSchema,
    primaryKeys: ['id'],
    relations: {
      // @ts-expect-error - 'nonexistent' is not a sibling registry key
      bad: { type: 'belongsTo', model: 'nonexistent', foreignKey: 'x' },
    },
  },
});

// P3 — concrete schema survives → FieldsOf literal union + primaryKeys check.
const registryFieldOk: FieldsOf<typeof registryUserMeta> = 'email';
// @ts-expect-error - 'nope' is not a schema field
const registryFieldBad: FieldsOf<typeof registryUserMeta> = 'nope';

defineModels({
  pkCheck: {
    tableName: 'pk_check',
    schema: UserSchema,
    // @ts-expect-error - 'bogus' is not a schema key
    primaryKeys: ['bogus'],
  },
});

// P2 — wired output stays assignable to the wide existential forms (the pinned
// B1 variance guard): heterogeneous collections mixing registry-wired and
// defineModel-produced models, plus Model<T> partial applications.
const registryModels: Model[] = [registryDb.users, registryDb.posts, UserModel, BareModel];
const registryMetas: MetaInput[] = [
  registryUserMeta,
  userMeta,
  defineMeta({ model: registryDb.posts }),
];
const registryModelT: Model<typeof UserSchema> = registryDb.users;
const registryModelTT: Model<typeof UserSchema, unknown> = registryDb.users;

// A relation-less registry entry stays permissive, like a bare defineModel.
const registryBareDb = defineModels({
  bare: { tableName: 'bare', schema: UserSchema, primaryKeys: ['id'] },
});
const registryBareMeta = defineMeta({ model: registryBareDb.bare });
const registryBareRel: RelationNamesOf<typeof registryBareMeta> = 'any-name-compiles';

// ============================================================================
// F5b — the `external: true` escape hatch (off-registry targets)
// ============================================================================

// Accepted: external target with author-supplied schema, exactly as a raw
// RelationConfig — sibling-key constraint and auto-population are off.
const externalDb = defineModels({
  users: {
    tableName: 'users',
    schema: UserSchema,
    primaryKeys: ['id'],
    relations: {
      posts: { type: 'hasMany', model: 'posts', foreignKey: 'authorId' },
      org: {
        type: 'belongsTo',
        model: 'organizations',
        foreignKey: 'orgId',
        external: true,
        schema: RegistryPostSchema,
      },
    },
  },
  posts: { tableName: 'posts', schema: RegistryPostSchema, primaryKeys: ['id'] },
});

// The escape is explicit: a non-sibling target WITHOUT the marker stays rejected.
defineModels({
  users: {
    tableName: 'users',
    schema: UserSchema,
    primaryKeys: ['id'],
    relations: {
      // @ts-expect-error - non-sibling target without `external: true` is rejected
      org: { type: 'belongsTo', model: 'organizations', foreignKey: 'orgId' },
    },
  },
});

// A mixed internal+external map still assigns wide (B1 guard holds with the
// escape-hatch union present in the input type).
const externalModels: Model[] = [externalDb.users, externalDb.posts];
const externalRelOk: RelationNamesOf<
  ReturnType<
    typeof defineMeta<
      typeof externalDb.users.schema,
      unknown,
      NonNullable<typeof externalDb.users.relations>
    >
  >
> = 'org';

// ============================================================================
// F5c — D7 drop pin: cross-model response typing stays ERASED. The wired
// relation value is the bare RelationConfig — assignable BOTH ways — so the
// sibling's concrete schema type does NOT flow into the output (recovering it
// would need the rejected key-union generic; see the typed-relations memory).
// ============================================================================

type WiredAuthorRelation = NonNullable<typeof registryDb.posts.relations>['author'];
const wiredToBare: RelationConfig = {} as WiredAuthorRelation;
const bareToWired: WiredAuthorRelation = {} as RelationConfig;

// ============================================================================
// F5d — defineModelsExtending: base keys become referenceable siblings; the
// combined keyspace is typo-checked; output preserves both maps' narrow types.
// ============================================================================

import { defineModelsExtending } from 'hono-crud';

const registryExtended = defineModelsExtending(
  {
    projects: {
      tableName: 'projects',
      schema: RegistryPostSchema,
      primaryKeys: ['id'],
      relations: {
        // Targets a BASE key — accepted.
        owner: { type: 'belongsTo', model: 'users', foreignKey: 'authorId' },
        // Targets a same-call sibling — accepted.
        labels: { type: 'hasMany', model: 'labels', foreignKey: 'authorId' },
      },
    },
    labels: { tableName: 'labels', schema: RegistryPostSchema, primaryKeys: ['id'] },
  },
  { extends: registryDb },
);

const extendedProjectsMeta = defineMeta({ model: registryExtended.projects });
const extendedRelOk: RelationNamesOf<typeof extendedProjectsMeta> = 'owner';
// @ts-expect-error - 'ownr' is not a declared relation name
const extendedRelBad: RelationNamesOf<typeof extendedProjectsMeta> = 'ownr';

// Base entries survive on the combined output with their narrow types intact.
const extendedBaseMeta = defineMeta({ model: registryExtended.users });
const extendedBaseRel: RelationNamesOf<typeof extendedBaseMeta> = 'posts';
const extendedModels: Model[] = [registryExtended.projects, registryExtended.users];

// Unknown target across BOTH keyspaces stays rejected.
defineModelsExtending(
  {
    bad: {
      tableName: 'bad',
      schema: UserSchema,
      primaryKeys: ['id'],
      relations: {
        // @ts-expect-error - 'nonexistent' is neither a base key nor a same-call sibling
        x: { type: 'belongsTo', model: 'nonexistent', foreignKey: 'x' },
      },
    },
  },
  { extends: registryDb },
);

export {
  registryDb,
  registryUserMeta,
  registryPostMeta,
  registryRelOk,
  registryRelOk2,
  registryRelBad,
  registryFieldOk,
  registryFieldBad,
  registryModels,
  registryMetas,
  registryModelT,
  registryModelTT,
  registryBareRel,
  externalDb,
  externalModels,
  externalRelOk,
  wiredToBare,
  bareToWired,
  registryExtended,
  extendedRelOk,
  extendedRelBad,
  extendedBaseRel,
  extendedModels,
};

// ============================================================================
// F5e — direction-aware field-key checks inside defineModels: hasOne/hasMany
// take `foreignKey` from the RELATED sibling's schema and `localKey` from the
// LOCAL schema; belongsTo flips both; `scope.tenantField`/`scope.softDeleteField`
// always name RELATED columns (the include-time filter side, per the batch
// loader). Wide schemas degrade to `string`; `external: true` keeps raw strings.
// ============================================================================

import type { ZodObject, ZodRawShape } from 'zod';

// Positive — every member checks its direction-correct side. The sharp probes
// are the keys that exist on only ONE of the two schemas: `title`/`authorId`
// are posts-only, `name`/`email` are users-only.
const fieldKeyDb = defineModels({
  users: {
    tableName: 'users',
    schema: UserSchema,
    primaryKeys: ['id'],
    relations: {
      posts: {
        type: 'hasMany',
        model: 'posts',
        foreignKey: 'authorId', // ∈ posts (related holds the FK)
        localKey: 'id', // ∈ users (local)
        scope: { tenantField: 'authorId', softDeleteField: 'title' }, // ∈ posts
      },
      pinned: { type: 'hasOne', model: 'posts', foreignKey: 'authorId' },
    },
  },
  posts: {
    tableName: 'posts',
    schema: RegistryPostSchema,
    primaryKeys: ['id'],
    relations: {
      author: {
        type: 'belongsTo',
        model: 'users',
        foreignKey: 'authorId', // ∈ posts (LOCAL holds the FK — direction flip)
        localKey: 'name', // ∈ users (related)
      },
    },
  },
});

// Negatives — one-liner relations so each rejection stays on its directive's line.
defineModels({
  users: {
    tableName: 'users',
    schema: UserSchema,
    primaryKeys: ['id'],
    relations: {
      // @ts-expect-error - hasMany foreignKey typo: 'authorIdd' is not a posts key
      n1: { type: 'hasMany', model: 'posts', foreignKey: 'authorIdd' },
      // @ts-expect-error - hasMany foreignKey must be a RELATED key; 'name' is users-only
      n2: { type: 'hasMany', model: 'posts', foreignKey: 'name' },
      // @ts-expect-error - hasMany localKey must be a LOCAL key; 'title' is posts-only
      n4: { type: 'hasMany', model: 'posts', foreignKey: 'authorId', localKey: 'title' },
      // @ts-expect-error - scope.tenantField must be a RELATED key; 'nope' is nowhere
      n6: {
        type: 'hasMany',
        model: 'posts',
        foreignKey: 'authorId',
        scope: { tenantField: 'nope' },
      },
    },
  },
  posts: {
    tableName: 'posts',
    schema: RegistryPostSchema,
    primaryKeys: ['id'],
    relations: {
      // @ts-expect-error - belongsTo foreignKey must be a LOCAL key; 'email' is users-only
      n3: { type: 'belongsTo', model: 'users', foreignKey: 'email' },
      // @ts-expect-error - belongsTo localKey must be a RELATED key; 'title' is posts-only
      n5: { type: 'belongsTo', model: 'users', foreignKey: 'authorId', localKey: 'title' },
    },
  },
});

// defineModelsExtending — field checks resolve against the BASE sibling's schema.
const fieldKeyExtended = defineModelsExtending(
  {
    projects: {
      tableName: 'projects',
      schema: RegistryPostSchema,
      primaryKeys: ['id'],
      relations: {
        owner: { type: 'belongsTo', model: 'users', foreignKey: 'authorId', localKey: 'email' },
      },
    },
  },
  { extends: registryDb },
);

defineModelsExtending(
  {
    projects: {
      tableName: 'projects',
      schema: RegistryPostSchema,
      primaryKeys: ['id'],
      relations: {
        // @ts-expect-error - belongsTo localKey checks the BASE users schema; 'title' is not a users key
        owner: { type: 'belongsTo', model: 'users', foreignKey: 'authorId', localKey: 'title' },
      },
    },
  },
  { extends: registryDb },
);

// `external: true` keeps RAW strings on every field member (off-registry target).
const fieldKeyExternal = defineModels({
  users: {
    tableName: 'users',
    schema: UserSchema,
    primaryKeys: ['id'],
    relations: {
      org: {
        type: 'belongsTo',
        model: 'organizations',
        foreignKey: 'orgId',
        localKey: 'org_pk',
        scope: { tenantField: 'tenant_col', softDeleteField: 'deleted_col' },
        external: true,
        schema: RegistryPostSchema,
      },
    },
  },
});

// Wide (un-narrowed) schemas degrade every field member to permissive `string`.
declare const wideRegistrySchema: ZodObject<ZodRawShape>;
const wideRegistryDb = defineModels({
  a: {
    tableName: 'a',
    schema: wideRegistrySchema,
    primaryKeys: ['id'],
    relations: {
      b: {
        type: 'hasMany',
        model: 'b',
        foreignKey: 'anything-goes',
        localKey: 'whatever',
        scope: { tenantField: 'x', softDeleteField: 'y' },
      },
    },
  },
  b: { tableName: 'b', schema: wideRegistrySchema, primaryKeys: ['id'] },
});

export { fieldKeyDb, fieldKeyExtended, fieldKeyExternal, wideRegistryDb };
