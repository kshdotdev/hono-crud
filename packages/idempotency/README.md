# @hono-crud/idempotency

Idempotency middleware and storage backends for [hono-crud](https://github.com/kshdotdev/hono-crud).

## Install

```bash
npm install @hono-crud/idempotency hono-crud hono
```

## Usage

```ts
import {
  idempotency,
  setIdempotencyStorage,
  MemoryIdempotencyStorage,
} from '@hono-crud/idempotency';

setIdempotencyStorage(new MemoryIdempotencyStorage());

// Replays the original response for repeated requests carrying the same Idempotency-Key.
app.use('/api/*', idempotency());
```

Exports `idempotency`, `setIdempotencyStorage`, and `MemoryIdempotencyStorage`.
