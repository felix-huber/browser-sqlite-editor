import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { visualizer } from 'rollup-plugin-visualizer'

// Support subdirectory deployments via VITE_BASE environment variable
// Usage: VITE_BASE=/sqlocal/ npm run build
const base = process.env.VITE_BASE || '/'

export default defineConfig({
  base,
  // Cross-origin isolation headers for OPFS sync access handles
  // These are required for FileSystemSyncAccessHandle to work
  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
  worker: {
    format: 'es', // Required: App.tsx creates worker with { type: 'module' }
    rollupOptions: {
      output: {
        entryFileNames: 'assets/worker-[name]-[hash].js',
        chunkFileNames: 'assets/worker-[name]-[hash].js',
      },
    },
  },
  plugins: [
    react(),
    // Generate bundle analysis when ANALYZE=true
    process.env.ANALYZE === 'true' && visualizer({
      filename: 'dist/stats.html',
      open: false,
      gzipSize: true,
      brotliSize: true,
      template: 'treemap',
    }),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/**/*'],
      manifest: false, // Use existing manifest.json from public/
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm,db,sqlite,woff,woff2,ttf,otf}'],
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
        navigateFallback: `${base}index.html`,
        navigateFallbackDenylist: [/^\/api/],
        skipWaiting: false, // Prompt user first
        clientsClaim: true, // Control clients after activation
      },
    }),
  ].filter(Boolean),
})
