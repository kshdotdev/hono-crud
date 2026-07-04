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

// Aggregate endpoint class field is schema-checked when M is narrowed.
import { AggregateEndpoint } from 'hono-crud';
declare abstract class NarrowAggregate extends AggregateEndpoint<
  import('hono').Env,
  typeof userMeta
> {}
type NarrowAggregateConfig = NarrowAggregate['aggregateConfig'];
const aggOk: NarrowAggregateConfig = { sumFields: ['id'] };
// @ts-expect-error - 'total' is not a schema field
const aggBad: NarrowAggregateConfig = { sumFields: ['total'] };

// Wide meta stays permissive on every field surface.
crud(wideMeta).list().filter('whatever').search('anything').sortable('x').defaultSort('y');

export { listFieldsCfg, listFieldsBad, endpointsFieldsCfg, endpointsFieldsBad, aggOk, aggBad };
