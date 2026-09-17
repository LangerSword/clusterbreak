import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // The sim engine lives outside the frontend root (../sim) and is imported
  // directly from source; allow the dev server to serve it too.
  server: { fs: { allow: [".."] } },
})
