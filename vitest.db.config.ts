import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tests de base de données : un seul fichier à la fois, la base est partagée.
export default defineConfig({
  resolve: { alias: { 'server-only': fileURLToPath(new URL('./tests/db/server-only-stub.ts', import.meta.url)) } },
  test: {
    include: ['tests/db/**/*.test.ts'],
    globalSetup: ['tests/db/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
