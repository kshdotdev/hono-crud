---
"hono-crud": patch
---

fix(core): uniform plaintext for audit and version-history under field encryption

Downstream record snapshots now carry **plaintext** for encrypted fields,
consistent with the create/update/read verbs. Previously single delete/update/
upsert audited the pre-mutation snapshot as **ciphertext** (the row read from
storage was never decrypted), and the `deleted`/`updated` event `previousData`
(what `subscribe` consumers receive) leaked ciphertext too. Audit inputs are now
decrypted before the audit call on every verb, so `previousRecord` / `record` /
`changes` are meaningful; the existing `audit` toggles (`storeRecord` /
`storePreviousRecord` / `trackChanges`) remain the opt-out.

The version-history read endpoints (`versionHistory`, `versionRead`) now decrypt
each snapshot's `data` on return, and `versionCompare` decrypts **both** sides
before diffing — two versions with the same plaintext but different IVs at rest
show **no** change for that field (a raw ciphertext diff reported a spurious
change on every write). `versionRollback` returns the historical plaintext in its
response.

Snapshots stay **ciphertext at rest**: the version snapshot saved on update and
the row `versionRollback` writes back are never re-encrypted (double-encrypting a
`{ ct, iv, v }` envelope would `String()`-cast and corrupt it) — the rolled-back
row decrypts to the historical plaintext on the next read.
