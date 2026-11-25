import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** `/` for Vercel and local dev. GitHub Pages sets VITE_BASE to the repo subpath. */
function resolveBase(): string {
  const raw = process.env.VITE_BASE?.trim() || '/'
  if (raw === '/' || raw === './') return raw
  return raw.endsWith('/') ? raw : `${raw}/`
}

export default defineConfig({
  base: resolveBase(),
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/paper')) return 'paper'
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/'))
            return 'react'
        },
      },
    },
  },
})
