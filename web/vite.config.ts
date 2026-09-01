import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // design/tokens.css lives outside the web root; let Vite reach it.
  server: { fs: { allow: ['..'] } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    /**
     * The editor's schema is the document format (ADR-0005), so TipTap and
     * ProseMirror are not a dependency we can trade away: issue 07 took the
     * bundle from 394 kB to 856 kB (120 kB to 267 kB gzipped). Rollup's 500 kB
     * warning is advice for a page served over a network; this one is served by
     * the same localhost process that holds the database, so the number is not
     * a cost to anyone. Raised rather than silenced, so a bundle that doubles
     * again still says so. Revisit — by code-splitting, not by a smaller
     * editor — the day the GUI is served over a network.
     */
    chunkSizeWarningLimit: 1000,
  },
});
