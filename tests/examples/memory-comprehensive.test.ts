import { beforeEach, describe, it } from 'vitest';
import { app } from '../../examples/memory/comprehensive';
import { clear, exerciseComprehensiveCrud } from './harness';

describe('memory comprehensive example', () => {
  beforeEach(async () => {
    await clear(app);
  });

  it('runs the public CRUD feature flow through the exported app', async () => {
    await exerciseComprehensiveCrud(app);
  });
});
