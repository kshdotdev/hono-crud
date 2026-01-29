# hono-crud Examples

This directory contains comprehensive examples demonstrating all features of hono-crud with different database adapters.

## Directory Structure

```
examples/
├── docker-compose.yml     # PostgreSQL for Drizzle and Prisma examples
├── shared/
│   └── schemas.ts         # Shared Zod schemas used across adapters
│
├── memory/                # In-memory adapter (no database required)
│   ├── basic-crud.ts
│   ├── soft-delete.ts
│   ├── batch-operations.ts
│   ├── upsert.ts
│   ├── relations.ts
│   ├── comprehensive.ts   # All features combined
│   └── ...
│
├── drizzle/               # Drizzle ORM + PostgreSQL
│   ├── schema.ts          # Drizzle table definitions
│   ├── db.ts              # Database connection
│   ├── basic-crud.ts
│   ├── filtering.ts
│   ├── soft-delete.ts
│   ├── batch-operations.ts
│   ├── upsert.ts
│   ├── relations.ts
│   └── comprehensive.ts   # All features combined
│
└── prisma/                # Prisma ORM + PostgreSQL
    ├── schema.prisma      # Prisma schema
    ├── db.ts              # Prisma client setup
    ├── basic-crud.ts
    ├── filtering.ts
    ├── soft-delete.ts
    ├── batch-operations.ts
    ├── upsert.ts
    ├── relations.ts
    └── comprehensive.ts   # All features combined
```

## Quick Start

### Memory Adapter (No Database Required)

```bash
# Run any memory example directly
npx tsx examples/memory/basic-crud.ts
npx tsx examples/memory/comprehensive.ts
```

### Drizzle Adapter (PostgreSQL)

```bash
# 1. Start PostgreSQL
cd examples && docker compose up -d

# 2. Run any Drizzle example
npx tsx examples/drizzle/basic-crud.ts
npx tsx examples/drizzle/comprehensive.ts
```

### Prisma Adapter (PostgreSQL)

```bash
# 1. Start PostgreSQL
cd examples && docker compose up -d

# 2. Generate Prisma client
npx prisma generate --schema=examples/prisma/schema.prisma

# 3. Push schema to database
npx prisma db push --schema=examples/prisma/schema.prisma

# 4. Run any Prisma example
npx tsx examples/prisma/basic-crud.ts
npx tsx examples/prisma/comprehensive.ts
```

## Database Setup

The examples use PostgreSQL with the following default settings:

| Setting | Value |
|---------|-------|
| Host | localhost |
| Port | 5432 |
| User | postgres |
| Password | postgres |
| Database | hono_crud |

You can override these with environment variables:

```bash
export DB_HOST=localhost
export DB_PORT=5432
export DB_USER=postgres
export DB_PASSWORD=postgres
export DB_NAME=hono_crud

# Or for Prisma:
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/hono_crud?schema=public"
```

## Available Examples

| Example | Description | Features Demonstrated |
|---------|-------------|----------------------|
| `basic-crud.ts` | Getting started | Create, Read, Update, Delete, List |
| `filtering.ts` | Advanced filtering | eq, gt, gte, lt, lte, in, between, like, ilike, null |
| `soft-delete.ts` | Soft delete & restore | deletedAt, withDeleted, onlyDeleted, restore |
| `batch-operations.ts` | Bulk operations | Batch create, update, delete, restore |
| `upsert.ts` | Create or update | Single upsert, batch upsert, upsert keys |
| `relations.ts` | Related data | hasMany, hasOne, belongsTo, ?include= |
| `comprehensive.ts` | All features | Complete API with all features |

Memory adapter also includes:
- `cascade-delete.ts` - Cascading deletes with relations
- `nested-writes.ts` - Creating nested records in one request
- `field-selection.ts` - Selecting specific fields
- `computed-fields.ts` - Virtual computed fields
- `audit-logging.ts` - Track all changes
- `versioning.ts` - Version history and rollback
- `rate-limiting.ts` - API rate limiting

## Testing Examples

Once an example is running, you can test it with curl:

```bash
# Create a user
curl -X POST http://localhost:3456/users \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","name":"Alice","role":"admin"}'

# List users with filtering
curl "http://localhost:3456/users?role=admin"

# List users with relations
curl "http://localhost:3456/users?include=posts,profile"

# Search users
curl "http://localhost:3456/users?search=alice"

# Advanced filtering
curl "http://localhost:3456/users?age[gte]=18&age[lte]=65"

# Pagination
curl "http://localhost:3456/users?page=1&per_page=20"
```

## Swagger UI

All examples include Swagger UI at `http://localhost:3456/docs` for interactive API exploration.

## Verification Checklist

For each adapter, the comprehensive example tests:

- [ ] Basic CRUD (create, read, update, delete, list)
- [ ] Filtering (eq, gt, gte, lt, lte, in, between, like, ilike, null)
- [ ] Soft delete & restore
- [ ] Batch operations (create, update, delete, restore)
- [ ] Upsert operations
- [ ] Relations (?include=)
- [ ] Pagination & sorting
- [ ] Search functionality

## Troubleshooting

### PostgreSQL Connection Issues

```bash
# Check if PostgreSQL is running
docker compose ps

# View PostgreSQL logs
docker compose logs postgres

# Restart PostgreSQL
docker compose restart
```

### Prisma Issues

```bash
# Regenerate Prisma client
npx prisma generate --schema=examples/prisma/schema.prisma

# Reset database
npx prisma db push --schema=examples/prisma/schema.prisma --force-reset

# View Prisma Studio
npx prisma studio --schema=examples/prisma/schema.prisma
```

### Memory Adapter

The memory adapter stores data in memory, so data is lost when the server restarts. This is intentional for quick development and testing.
