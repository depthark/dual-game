import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  /* Relative asset paths so the same `dist/` works under both
     a normal HTTPS host AND Capacitor's capacitor://localhost / file://
     contexts on iOS and Android. */
  base: './',
  server: {
    port: 3000,
    open: true
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  },
  plugins: [
    VitePWA({
      /* Use the plugin's generated SW (replaces public/sw.js) */
      strategies: 'generateSW',
      registerType: 'autoUpdate',
      injectRegister: 'script',

      /* Point at the existing manifest */
      manifest: false,
      manifestFilename: 'manifest.json',

      workbox: {
        /* Precache ALL build outputs (JS, CSS, HTML, icons) */
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],

        /* Cache-first for everything — game has no server data */
        runtimeCaching: [],

        /* The privacy + support pages are real standalone pages, not part of the game
           SPA. Without this the SW's index.html navigate-fallback would serve
           the game at /privacy for anyone who already has the SW installed —
           and that URL is what App Store Connect points at. */
        navigateFallbackDenylist: [/^\/privacy/, /^\/support/],

        /* Activate new SW immediately without waiting */
        skipWaiting: true,
        clientsClaim: true,

        /* Increase limit — Phaser bundle is large (~2 MB) */
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024
      }
    })
  ]
});
