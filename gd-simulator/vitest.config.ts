import { defineConfig } from 'vitest/config';

// Engine unit tests run in a plain Node environment — no React/Tailwind plugins
// needed (kept separate from vite.config.ts so tests start fast and clean).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
