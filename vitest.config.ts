import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: true,
      coverage: {
        provider: 'v8',
        // Listing the sources makes files no test imports count as 0 %, instead
        // of silently vanishing from the report.
        include: ['src/**/*.{ts,tsx}', 'netlify/**/*.ts'],
        exclude: ['**/*.test.{ts,tsx}', '**/*.d.ts', 'src/main.tsx'],
        reporter: ['text-summary', 'html'],
        // A floor, raised as tests are added: coverage may only go up. The chart
        // and canvas components are driven by the end-to-end suite instead.
        thresholds: { statements: 32, branches: 31, functions: 37, lines: 33 },
      },
    },
  })
);
