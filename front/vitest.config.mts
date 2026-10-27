import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  css: {
    // styles.foo === 'foo' — классы можно проверять в тестах
    modules: { generateScopedName: '[local]' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: { include: /.+/, modules: { classNameStrategy: 'non-scoped' } },
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/lib/**', 'src/components/**'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.css'],
      reporter: ['text', 'html'],
    },
  },
});
