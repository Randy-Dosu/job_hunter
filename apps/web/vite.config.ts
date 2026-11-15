import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const apiTarget = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:4000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Bind to all interfaces so the preview host can reach the dev server, and
    // proxy API calls so browser code only ever talks to its own origin.
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    // The sandboxed preview is served from a different host than localhost.
    allowedHosts: true,
    proxy: {
      '/api': {
        target: apiTarget,
        // Present the API as the request's own origin so the session cookie and
        // Fastify's host checks behave exactly as they do in production.
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Keep the initial bundle small enough for a free-tier cold start.
    chunkSizeWarningLimit: 700,
  },
});
