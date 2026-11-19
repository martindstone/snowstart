import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // The browser talks to the relay through the dev server (same origin), so a remote viewer reaches the
    // relay on this machine instead of their own localhost:4000.
    proxy: {
      '/api': 'http://127.0.0.1:4000',
    },
  },
})
