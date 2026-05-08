import { defineConfig } from 'vite';

// Bind to 0.0.0.0 so we can hit the dev server from the phone on the same LAN.
// Run `npm run dev`, then on your phone open: http://<computer-LAN-ip>:5173
export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false
  },
  build: {
    target: 'es2022',
    sourcemap: true
  }
});
