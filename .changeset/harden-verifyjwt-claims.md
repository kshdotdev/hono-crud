---
'hono-crud': patch
---

Auth hardening: `verifyJWT` now validates claim shape via `safeParseJWTClaims` after signature verification — a validly-signed token with structurally malformed claims (e.g. numeric `sub`, object `roles`) is rejected with 401 `Invalid token claims` instead of being blindly cast into `JWTClaims`; this matches what `createJWTMiddleware` already did. `decodeJWT` now returns its honest unverified type `{ header: unknown; payload: JWTPayload } | null` (was falsely advertising validated `JWTClaims`) — narrow with `safeParseJWTClaims` before trusting any claim.
