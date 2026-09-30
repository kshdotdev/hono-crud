---
'hono-crud': patch
---

`registerCrud` (and `toOpenApiPaths`) throw at setup when a base-path param shares its name with a sub-route param. `registerCrud(app, '/notes/:id/comments', { read })` mounted `/notes/:id/comments/:id`, where `id` resolved to the note's id, so every item request silently looked up the wrong record. Name the parent param instead (`:noteId`); collection-only registrations under such a path are unaffected.
