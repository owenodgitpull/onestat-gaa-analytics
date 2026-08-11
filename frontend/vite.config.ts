import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3001,
    proxy: {
      '/api': {
        target: 'http://localhost:8001',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split heavy, rarely-changing vendor libs into their own cacheable
        // chunks instead of one large main bundle (was 1.8MB+ uncompressed).
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          // html2canvas / jspdf are dynamically import()'d only when a report
          // is exported to PDF — leave them alone so Rollup keeps them as
          // separate async chunks instead of pulling them into an eager bundle.
          if (id.includes('html2canvas') || id.includes('jspdf')) return undefined
          if (id.includes('recharts') || id.includes('d3-')) return 'vendor-charts'
          if (id.includes('@dnd-kit')) return 'vendor-dnd'
          if (id.includes('lucide-react')) return 'vendor-icons'
          if (id.includes('framer-motion')) return 'vendor-motion'
          if (
            id.includes('react-markdown') || id.includes('remark') ||
            id.includes('micromark') || id.includes('mdast') ||
            id.includes('unist') || id.includes('hast') || id.includes('vfile') ||
            id.includes('property-information') || id.includes('space-separated-tokens') ||
            id.includes('comma-separated-tokens')
          ) return 'vendor-markdown'
          if (
            id.includes('/react-dom/') || id.includes('/react/') ||
            id.includes('react-router') || id.includes('scheduler')
          ) return 'vendor-react'
          return 'vendor'
        },
      },
    },
  },
})

