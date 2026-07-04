---
'hono-crud': patch
---

Harden `defineModels`/`defineModelsExtending` sibling lookup to own properties only: under `onUnknownModel: 'ignore'`, an unresolved relation target colliding with an `Object.prototype` member (e.g. `'constructor'`) is now left unresolved as authored instead of being wired against the prototype member.
