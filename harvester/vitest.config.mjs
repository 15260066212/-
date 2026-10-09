import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.{js,mjs}'],
    environment: 'node',
    globals: false,
    testTimeout: 15000,
    setupFiles: ['__tests__/setup/mock-playwright.mjs'],
  },
});
