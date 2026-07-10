import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Dev-proxy: /api → бекенд (пишеться паралельно, за замовчуванням :3000)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
  },
});
