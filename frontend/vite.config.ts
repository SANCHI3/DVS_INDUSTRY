import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

const backendUrl = process.env.VITE_BACKEND_URL ?? 'http://localhost:3000'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  // Proxy /api requests to the backend dev server
  server: {
    proxy: {
      '/api': {
        target:      backendUrl,
        changeOrigin: true,
        secure:       false,
      },
      // Also proxy /uploads (profile images served by backend)
      '/uploads': {
        target:      backendUrl,
        changeOrigin: true,
        secure:       false,
      },
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],

  build: {
    rollupOptions: {
      output: {
        // A function (not an object) so only the modules actually imported
        // land in each chunk; listing a package forces all of it in.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          // recharts and the helpers only it uses
          if (/[\\/](recharts[^\\/]*|d3-[^\\/]+|victory-vendor|lodash|decimal\.js-light|react-smooth|fast-equals|internmap|eventemitter3|tiny-invariant)[\\/]/.test(id)) return 'charts'
          if (/[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react'
          return 'vendor'
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
})
