/**
 * Compatibility entrypoint for the example API tests.
 *
 * The old runner started demo servers and wrote JSON response snapshots under
 * tests/api-responses. The examples are now tested directly through Vitest by
 * importing their app factories and asserting responses with app.request().
 *
 * Prerequisites:
 * 1. pnpm run db:up
 * 2. pnpm run prisma:generate
 * 3. pnpm run prisma:push
 *
 * Run: pnpm exec tsx scripts/test-api.ts
 */

import { spawn } from 'child_process';

function run(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: process.cwd(),
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      const reason = signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`;
      reject(new Error(`${command} ${args.join(' ')} failed with ${reason}`));
    });
  });
}

async function main(): Promise<void> {
  await run('pnpm', ['run', 'test:examples']);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
