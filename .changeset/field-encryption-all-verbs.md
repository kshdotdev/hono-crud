---
"hono-crud": patch
---

fix(core): apply field encryption across all write/read verbs

`fieldEncryption` previously only encrypted on create/update and decrypted on
read/list. Every other verb leaked: upsert, clone, import, bulk-patch and the
batch writes (batch-create/update/upsert) persisted **plaintext** for encrypted
fields, and search, export, restore and the batch reads (batch-delete/restore)
returned **ciphertext**. Encryption is now applied at the same lifecycle
position (after the before-hook, before the adapter write) and decryption after
the adapter read (before the after-hook/response) on the full verb surface, so
a round trip is transparent regardless of which verb wrote or read the row.

`aggregate` is intentionally exempt: non-deterministic encryption makes grouping
and MIN/MAX over an encrypted field meaningless, and numeric aggregations never
expose the plaintext.

Note: on SQL adapters an encrypted column must be a JSON column (Drizzle
`text(name, { mode: 'json' })` / Prisma `Json`) to hold the `{ ct, iv, v }`
envelope — a plain text/String column cannot.
