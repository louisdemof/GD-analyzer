import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // GitHub Pages serves under /GD-analyzer/; Vercel serves at root.
  // Vercel sets process.env.VERCEL at build time, so pick the base automatically
  // and keep both deploy targets working.
  base: process.env.VERCEL ? '/' : '/GD-analyzer/',
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
