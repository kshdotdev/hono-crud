# @hono-crud/cache

Caching mixins and storage backends for [hono-crud](https://github.com/kshdotdev/hono-crud).

## Install

```bash
npm install @hono-crud/cache hono-crud hono
```

## Usage

```ts
import { MemoryCacheStorage } from '@hono-crud/cache';

const cacheStorage = new MemoryCacheStorage();
// Wire the storage into cache-enabled endpoints / mixins.
```

Exports cache storage backends (e.g. `MemoryCacheStorage`) and the caching mixins used by hono-crud endpoints.
