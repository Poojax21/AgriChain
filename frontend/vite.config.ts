import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['crop-photos/*.jpg', 'demo-crops/*.png'],
      manifest: {
        name: 'AgriChain — Farm Marketplace',
        short_name: 'AgriChain',
        description: 'AI-graded farm lots, escrowed trade, DAO disputes. Chain actions need connectivity.',
        theme_color: '#01472e',
        background_color: '#fefae0',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // App shell precached. API reads cached network-first for offline
        // viewing; chain transactions are NEVER queued (nonces forbid it).
        runtimeCaching: [
          {
            urlPattern: /^http:\/\/localhost:5000\/api\/(listings|users|sustainability|market)/,
            handler: 'NetworkFirst',
            options: { cacheName: 'agrichain-api', expiration: { maxEntries: 50, maxAgeSeconds: 86400 } },
          },
          {
            urlPattern: /^http:\/\/localhost:5000\/(crop-photos|demo-crops|dispute-evidence)\//,
            handler: 'CacheFirst',
            options: { cacheName: 'agrichain-images', expiration: { maxEntries: 100, maxAgeSeconds: 604800 } },
          },
        ],
      },
    }),
  ],
  server: {
    port: 3000,
    host: true,
  },
});
