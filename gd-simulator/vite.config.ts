import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api/aneel': {
        target: 'https://dadosabertos.aneel.gov.br',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/aneel/, '/api/3/action'),
      },
    },
  },
})
