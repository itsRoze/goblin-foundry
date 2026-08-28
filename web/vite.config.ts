import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // design/tokens.css lives outside the web root; let Vite reach it.
  server: { fs: { allow: ['..'] } },
  build: { outDir: 'dist', emptyOutDir: true },
});
