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
    sourcemap: true,
    rollupOptions: {
      output: {
        // Beta 1.7 — split heavy, rarely-changing vendor deps into their
        // own chunks. Three.js is the bulk of the bundle and almost never
        // changes between our deploys, so giving it a stable vendor chunk
        // (a) shrinks the app entry chunk well under the 240 KB-gzipped
        // target, (b) lets the browser fetch app + vendor in parallel,
        // and (c) keeps Three cached across app-only redeploys. Supabase
        // is the next-heaviest dep and only matters for signed-in cloud
        // saves, so it gets its own chunk too.
        manualChunks(id: string) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/@supabase')) return 'supabase';
          return undefined;
        }
      }
    }
  }
});
