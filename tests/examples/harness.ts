import { expect } from 'vitest';

export type ExampleApp = {
  request: (path: string, init?: RequestInit) => Promise<Response>;
};

export type SuccessResponse<T> = {
  success: true;
  result: T;
};

export type ListResponse<T> = SuccessResponse<T[]> & {
  result_info?: {
    total_count?: number;
    has_next_page?: boolean;
    has_prev_page?: boolean;
  };
};

export async function json<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

export async function expectOk(response: Response): Promise<void> {
  expect(response.status).toBeGreaterThanOrEqual(200);
  expect(response.status).toBeLessThan(300);
}

export async function seed(app: ExampleApp): Promise<void> {
  const response = await app.request('/seed');
  await expectOk(response);
}

export async function clear(app: ExampleApp): Promise<void> {
  const response = await app.request('/clear');
  await expectOk(response);
}

export async function exerciseComprehensiveCrud(app: ExampleApp): Promise<void> {
  await seed(app);

  let response = await app.request('/health');
  await expectOk(response);
  expect(await json<{ status: string }>(response)).toMatchObject({ status: 'ok' });

  response = await app.request('/users');
  await expectOk(response);
  const list = await json<ListResponse<{ id: string; email: string; role: string }>>(response);
  expect(list.success).toBe(true);
  expect(list.result.length).toBeGreaterThanOrEqual(3);

  response = await app.request('/users?role=admin');
  await expectOk(response);
  const admins = await json<ListResponse<{ role: string }>>(response);
  expect(admins.result.every((user) => user.role === 'admin')).toBe(true);

  response = await app.request('/users?search=alice');
  await expectOk(response);
  const search = await json<ListResponse<{ email: string }>>(response);
  expect(search.result.some((user) => user.email === 'alice@example.com')).toBe(true);

  response = await app.request('/users/a0000000-0000-0000-0000-000000000001?include=posts,profile');
  await expectOk(response);
  const userWithRelations = await json<SuccessResponse<{ posts?: unknown[]; profile?: unknown }>>(response);
  expect(userWithRelations.success).toBe(true);
  expect(Array.isArray(userWithRelations.result.posts)).toBe(true);
  expect(userWithRelations.result.profile).toBeTruthy();

  response = await app.request('/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `example-${crypto.randomUUID()}@example.com`,
      name: 'Example Test User',
      role: 'user',
      age: 31,
      status: 'active',
    }),
  });
  await expectOk(response);
  const created = await json<SuccessResponse<{ id: string; name: string }>>(response);
  expect(created.result.name).toBe('Example Test User');

  response = await app.request(`/users/${created.result.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Example Test User Updated' }),
  });
  await expectOk(response);
  const updated = await json<SuccessResponse<{ name: string }>>(response);
  expect(updated.result.name).toBe('Example Test User Updated');

  response = await app.request('/users/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: [
        { email: `batch-${crypto.randomUUID()}@example.com`, name: 'Batch A', role: 'user' },
        { email: `batch-${crypto.randomUUID()}@example.com`, name: 'Batch B', role: 'guest' },
      ],
    }),
  });
  await expectOk(response);

  response = await app.request('/categories', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Music', description: 'Music posts', sortOrder: 4 }),
  });
  await expectOk(response);
  const upserted = await json<SuccessResponse<{ name: string }>>(response);
  expect(upserted.result.name).toBe('Music');

  response = await app.request('/users/a0000000-0000-0000-0000-000000000003', {
    method: 'DELETE',
  });
  await expectOk(response);

  response = await app.request('/users?onlyDeleted=true');
  await expectOk(response);
  const deleted = await json<ListResponse<{ id: string }>>(response);
  expect(deleted.result.some((user) => user.id === 'a0000000-0000-0000-0000-000000000003')).toBe(true);

  response = await app.request('/users/a0000000-0000-0000-0000-000000000003/restore', {
    method: 'POST',
  });
  await expectOk(response);

  response = await app.request('/openapi.json');
  await expectOk(response);
}

/**
 * Exercises the clone endpoint against a comprehensive example app.
 * Assumes /seed has populated the DB with the standard fixture (alice, bob, charlie).
 */
export async function exerciseClone(app: ExampleApp): Promise<void> {
  await seed(app);

  const sourceUserId = 'a0000000-0000-0000-0000-000000000001';

  // Read the source so we can compare against the clone.
  let response = await app.request(`/users/${sourceUserId}`);
  await expectOk(response);
  const source = await json<SuccessResponse<{ id: string; name: string; email: string; role: string; age?: number }>>(response);
  expect(source.result.email).toBe('alice@example.com');

  // 1. Basic clone with body override for the unique email + role passthrough.
  // Note: zod schema defaults on the body (role: .default('user')) clobber the
  // source value when the field is absent from the request, so callers must
  // explicitly forward fields they want to preserve from the source.
  const newEmail = `clone-${crypto.randomUUID()}@example.com`;
  response = await app.request(`/users/${sourceUserId}/clone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: newEmail, role: source.result.role, status: 'active' }),
  });
  await expectOk(response);
  const cloned = await json<SuccessResponse<{ id: string; name: string; email: string; role: string; age?: number }>>(response);
  expect(cloned.success).toBe(true);
  expect(cloned.result.id).toBeDefined();
  expect(cloned.result.id).not.toBe(sourceUserId);
  expect(cloned.result.email).toBe(newEmail);
  expect(cloned.result.name).toBe(source.result.name);
  expect(cloned.result.role).toBe(source.result.role);

  // 2. Source row remains intact in the DB.
  response = await app.request(`/users/${sourceUserId}`);
  await expectOk(response);
  const reReadSource = await json<SuccessResponse<{ email: string }>>(response);
  expect(reReadSource.result.email).toBe('alice@example.com');

  // 3. Body overrides win — name + email both replaced.
  const overrideEmail = `clone-${crypto.randomUUID()}@example.com`;
  response = await app.request(`/users/${sourceUserId}/clone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: overrideEmail, name: 'Cloned Alice' }),
  });
  await expectOk(response);
  const overridden = await json<SuccessResponse<{ name: string; email: string }>>(response);
  expect(overridden.result.name).toBe('Cloned Alice');
  expect(overridden.result.email).toBe(overrideEmail);

  // 4. Unknown source id — should not succeed.
  response = await app.request(`/users/00000000-0000-0000-0000-000000000999/clone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `clone-${crypto.randomUUID()}@example.com` }),
  });
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(response.status).toBeLessThan(500);

  // 5. Soft-deleted source — should also not be cloneable.
  response = await app.request(`/users/${sourceUserId}`, { method: 'DELETE' });
  await expectOk(response);
  response = await app.request(`/users/${sourceUserId}/clone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `clone-${crypto.randomUUID()}@example.com` }),
  });
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(response.status).toBeLessThan(500);
}
