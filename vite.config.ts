import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  worker: {
    format: 'es',
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    minify: 'esbuild',
    target: ['es2017', 'chrome98'],
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-recharts': ['recharts'],
          'vendor-xlsx': ['xlsx'],
          'vendor-ai': ['@anthropic-ai/sdk'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
  },
});