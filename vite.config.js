import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  build: { target: 'esnext' },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'CampusMove — VIT Vellore Bus Tracking',
        short_name: 'CampusMove',
        description: 'Live campus shuttle tracking. See where your bus is and when it arrives.',
        theme_color: '#2f7df6',
        background_color: '#f2f4f8',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        categories: ['travel', 'navigation', 'utilities'],
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Driver mode', short_name: 'Driver', url: '/driver' },
          { name: 'Map builder', short_name: 'Builder', url: '/builder' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
          {
            // Map tiles: cache aggressively — your campus doesn't move
            urlPattern: /^https:\/\/server\.arcgisonline\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Campus definition: serve cached instantly, refresh in background
            urlPattern: /\/api\/campus$/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'campus-data' },
          },
          {
            // Live positions must never be cached
            urlPattern: /\/api\/(positions|stream|health|end)/,
            handler: 'NetworkOnly',
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  // `vite preview` serves the built app — that's what makes the PWA installable
  // (service workers don't run from the dev server).
  preview: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true, ws: false } },
  },
  server: {
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
    allowedHosts: true,
    hmr: { clientPort: 443 },
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true, ws: false } },
  },
})
