import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  envDir: '../../',
  server: { port: Number(process.env.WEB_PORT ?? 5173) },
});
