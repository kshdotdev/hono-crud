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
