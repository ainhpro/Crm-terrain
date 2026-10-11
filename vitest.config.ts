import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { 'server-only': fileURLToPath(new URL('./tests/db/server-only-stub.ts', import.meta.url)) } },
  test: {
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
  },
});
