---
'hono-crud': patch
---

Relation-spec column-name members in `defineModels`/`defineModelsExtending` are now
compile-checked against the direction-correct model's schema keys: `hasOne`/`hasMany`
take `foreignKey` from the RELATED sibling's schema and `localKey` from the local
model's; `belongsTo` flips both (the local row holds the FK); `scope.tenantField` /
`scope.softDeleteField` always name RELATED columns. A typo'd FK column — which
previously loaded silently-empty includes at runtime — is now a compile error at the
authoring site. Wide (un-narrowed) schemas degrade to permissive `string`, and
`external: true` relations keep raw strings. Authoring-surface typing only — runtime
behavior, wired output, and `RelationConfig` are unchanged. (`RelationSpec`/`ModelSpec`
generic parameters changed: they now take the sibling schema-map plus the authoring
entry's key instead of a sibling key-union.)
