import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backendPort = process.env.WEB_PORT || '4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.VITE_PORT) || 5173,
    proxy: {
      '/api': {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true,
      },
      '/ws': {
        target: `ws://localhost:${backendPort}`,
        ws: true,
      },
    },
  },
});
