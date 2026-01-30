# hono-crud Development Rules

## TypeScript Rules

### NEVER use `any` type
- Use `unknown` for values of unknown type
- Create proper interfaces for known structures
- Use type assertions with `as unknown as TargetType` when casting is necessary
- Prefer generics over `any` for flexible typing

### Drizzle Adapter Pattern
The Drizzle adapter uses a two-tier type system:
1. **Public interface** (`DrizzleDatabase`): Uses `unknown` returns to accept any Drizzle database
2. **Internal interface** (`InternalDatabase`, `InternalQueryBuilder`): Uses specific method signatures
3. **Casting function** (`toInternal()`): Safely converts public to internal type for method calls

This pattern avoids coupling to specific Drizzle versions while maintaining internal type safety.
