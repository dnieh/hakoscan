import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The React frontend talks to server.js (the Express serial/SSE backend) over
// /api. In dev we run two processes — Vite here on 5173, server.js on 3100 —
// and proxy /api across. SSE (live/raw/scan) flows through untouched.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
    // Force a single React copy so Radix/our components share one hooks
    // dispatcher (a duplicate causes "Invalid hook call").
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3100',
        changeOrigin: true,
      },
    },
  },
  build: {
    // Built static assets land in the repo-root dist/, which server.js serves
    // in production and Electron loads.
    outDir: '../dist',
    emptyOutDir: true,
  },
});
