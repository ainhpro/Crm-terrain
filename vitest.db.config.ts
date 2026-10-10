import { defineConfig } from 'vitest/config';

// Tests de base de données : un seul fichier à la fois, la base est partagée.
export default defineConfig({
  test: {
    include: ['tests/db/**/*.test.ts'],
    globalSetup: ['tests/db/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
