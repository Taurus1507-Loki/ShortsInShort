import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    port: 5173,
    strictPort: true,
    // Same-origin API in development: cookies stay first-party and no CORS is needed.
    proxy: { '/api': { target: 'http://localhost:5000', changeOrigin: false, xfwd: true } },
  },
  build: { sourcemap: true, target: 'es2022' },
});
