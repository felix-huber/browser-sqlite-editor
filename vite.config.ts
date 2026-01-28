import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/**/*'],
      manifest: false, // Use existing manifest.json from public/
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm}'],
        // Precache wa-sqlite.wasm and all chunks
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024, // 10MB for WASM
        runtimeCaching: [
          {
            // CDN assets: cache-first with 1 week expiry
            urlPattern: /^https:\/\/cdn\./,
            handler: 'CacheFirst',
            options: {
              cacheName: 'cdn-assets',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 7 * 24 * 60 * 60, // 1 week
              },
            },
          },
          {
            // HTML: NetworkFirst
            urlPattern: /\.html$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'html-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
              },
            },
          },
          {
            // Static assets: CacheFirst
            urlPattern: /\.(js|css|wasm|png|jpg|jpeg|svg|gif|ico)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'static-assets',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
              },
            },
          },
        ],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/],
        skipWaiting: false, // Prompt user first
        clientsClaim: true, // Control clients after activation
      },
    }),
  ],
})
