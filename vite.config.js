import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/skill-api': {
        target: 'https://grupoheroicaapi.skillsuite.net',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/skill-api/, '/app/wssuite/api'),
      },
    },
  },
})
