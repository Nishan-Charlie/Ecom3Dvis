import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/** Proxy local Flask reconstruction API (same-origin in dev/preview). */
const reconProxy = {
  '/__recon': {
    target: 'http://127.0.0.1:5050',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/__recon/, ''),
  },
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    headers: {
      'Cache-Control': 'no-store',
    },
    proxy: reconProxy,
  },
  preview: {
    headers: {},
    proxy: reconProxy,
  },
})
