import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../examples/memory/alternative-apis';
import { clearStorage } from '../../src/adapters/memory/index.js';
import { expectOk, json, type ListResponse, type SuccessResponse } from './harness';

type User = {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
};

const paths = [
  '/class/users',
  '/function/users',
  '/builder/users',
  '/config/users',
  '/mixed/users',
] as const;

describe('memory alternative API patterns example', () => {
  beforeEach(() => {
    clearStorage();
  });

  it('registers class, functional, builder, config, and mixed endpoint classes', async () => {
    for (const path of paths) {
      const email = `${path.split('/')[1]}-${crypto.randomUUID()}@example.com`;

      let response = await app.request(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          name: `User ${path}`,
          role: 'user',
          status: 'active',
        }),
      });
      await expectOk(response);
      const created = await json<SuccessResponse<User>>(response);
      expect(created.result.email).toBe(email);

      response = await app.request(path);
      await expectOk(response);
      const listed = await json<ListResponse<User>>(response);
      expect(listed.result.some((user) => user.email === email)).toBe(true);

      response = await app.request(`${path}/${created.result.id}`);
      await expectOk(response);
      const read = await json<SuccessResponse<User>>(response);
      expect(read.result.id).toBe(created.result.id);
    }
  });
});
