# hono-crud

[![npm version](https://img.shields.io/npm/v/hono-crud.svg)](https://www.npmjs.com/package/hono-crud)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)

A powerful CRUD generator for [Hono](https://hono.dev) with Zod validation and automatic OpenAPI documentation.

## Features

- **Full CRUD Operations** - Automatically generate Create, Read, Update, Delete endpoints
- **OpenAPI/Swagger** - Auto-generated API documentation with Swagger UI and Scalar support
- **Database Adapters** - Built-in support for Prisma, Drizzle ORM, and in-memory storage
- **Zod Validation** - Type-safe request/response validation
- **TypeScript First** - Full type inference and autocompletion
- **Edge Ready** - Works with Cloudflare Workers, Deno, Bun, and Node.js
- **Customizable** - Override any generated route or add custom middleware

## Installation

```bash
# npm
npm install hono-crud

# pnpm
pnpm add hono-crud

# yarn
yarn add hono-crud

# bun
bun add hono-crud
```

## Quick Start

```typescript
import { Hono } from "hono";
import { HonoCrud } from "hono-crud";
import { MemoryAdapter } from "hono-crud/adapters/memory";
import { z } from "zod";

const app = new Hono();

// Define your schema
const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
});

// Create CRUD instance
const crud = new HonoCrud({
  adapter: new MemoryAdapter(),
});

// Register resource
crud.resource("users", {
  schema: UserSchema,
});

// Mount to your app
app.route("/api", crud.routes());

export default app;
```

## Database Adapters

### Memory Adapter

Perfect for prototyping and testing:

```typescript
import { MemoryAdapter } from "hono-crud/adapters/memory";

const adapter = new MemoryAdapter();
```

### Drizzle Adapter

For production use with Drizzle ORM:

```typescript
import { DrizzleAdapter } from "hono-crud/adapters/drizzle";
import { db } from "./db";
import { users } from "./schema";

const adapter = new DrizzleAdapter(db, {
  users: users,
});
```

### Prisma Adapter

For production use with Prisma:

```typescript
import { PrismaAdapter } from "hono-crud/adapters/prisma";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const adapter = new PrismaAdapter(prisma);
```

## API Documentation

OpenAPI documentation is automatically generated. Access it at:

- **Swagger UI**: `/docs`
- **Scalar**: `/reference`
- **OpenAPI JSON**: `/openapi.json`

## Authentication with better-auth

hono-crud integrates seamlessly with [better-auth](https://www.better-auth.com) for comprehensive authentication.

### Setup

1. **Mount better-auth handler** for authentication routes:

```typescript
import { Hono } from "hono";
import { auth } from "./auth"; // your better-auth instance
import { cors } from "hono/cors";

const app = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

// CORS (must be before routes)
app.use("/api/auth/*", cors({
  origin: "http://localhost:3000",
  credentials: true,
}));

// Mount better-auth
app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));
```

2. **Add session middleware** to inject user into context:

```typescript
app.use("*", async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  c.set("user", session?.user || null);
  c.set("session", session?.session || null);
  await next();
});
```

3. **Protect CRUD routes** with hono-crud guards:

```typescript
import { registerCrud, requireAuth, requireRoles } from "hono-crud";

registerCrud(app, "/api/users", {
  list: UserList,
  read: UserRead,
  update: UserUpdate,
  delete: UserDelete,
}, {
  middlewares: [requireAuth()],
  endpointMiddlewares: {
    delete: [requireRoles(["admin"])],
  },
});
```

### Architecture

```
Request → CORS → Session MW → Auth Guards → CRUD Endpoint
                    ↓
              better-auth
            (validates session)
```

- **better-auth** handles: login, signup, OAuth, 2FA, session management
- **hono-crud** handles: CRUD operations with authorization guards

## Examples

Check out the [examples](./examples) directory for complete working examples:

- [Memory Adapter Examples](./examples/memory)
- [Drizzle Examples](./examples/drizzle)
- [Prisma Examples](./examples/prisma)

## Requirements

- Node.js >= 18.0.0
- TypeScript >= 5.0 (recommended)

## License

[MIT](./LICENSE) - Kauan Guesser
