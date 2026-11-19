import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Runtime-only module; tests use a tiny fake (see test/fakes).
      'cloudflare:workers': fileURLToPath(
        new URL('./test/fakes/cloudflare-workers.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
