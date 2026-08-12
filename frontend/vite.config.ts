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
        // Split a few heavy, self-contained, leaf UI libs into their own
        // cacheable chunks. Deliberately conservative: an earlier attempt
        // that also split out react/react-router/markdown produced circular
        // chunk warnings from Rollup (risk of "cannot access before
        // initialization" at runtime) — reverted those groupings and left
        // everything else to Rollup's own automatic (cycle-free) chunking.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          // html2canvas / jspdf are dynamically import()'d only when a report
          // is exported to PDF — leave them alone so Rollup keeps them as
          // separate async chunks instead of pulling them into an eager bundle.
          if (id.includes('html2canvas') || id.includes('jspdf')) return undefined
          if (id.includes('recharts') || id.includes('d3-')) return 'vendor-charts'
          if (id.includes('@dnd-kit')) return 'vendor-dnd'
          if (id.includes('lucide-react')) return 'vendor-icons'
          return undefined
        },
      },
    },
  },
})

