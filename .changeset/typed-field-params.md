---
'hono-crud': patch
---

Schema-field authoring params are literal-checked: builder `.filter()`/`.search()`/`.sortable()`/`.defaultSort()`/`.allowedFields()`/`.blockedFields()`, functional `filterFields`/`searchFields`/`sortFields`/`allowedUpdateFields`/`blockedUpdateFields`, config-API `filtering.fields`/`search.fields`/`sorting.fields`+`default`/`update.fields.allowed|blocked`/`SearchEndpointConfig.fields`/`AggregateEndpointConfig.fields`, and the `AggregateConfig` allow-lists (`sumFields`/`avgFields`/`minMaxFields`/`countDistinctFields`/`groupByFields`, checked on narrowed aggregate endpoint subclasses) now take `FieldsOf<M>` — misspelled column names fail to compile, wide metas stay permissive. Field-selection arrays deliberately stay `string[]` (they legitimately mix schema, computed, and relation names).
