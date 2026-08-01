import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const mount = '/qqbot'
const port = 5188
const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  base: `${mount}/`,
  resolve: {
    alias: { '@': path.join(rootDir, 'src') },
  },
  server: {
    port,
    strictPort: true,
    host: '127.0.0.1',
    proxy: {
      '/api': { target: 'http://127.0.0.1:6969', changeOrigin: true },
    },
  },
  preview: {
    port,
    strictPort: true,
    host: '127.0.0.1',
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    reportCompressedSize: false,
  },
})
