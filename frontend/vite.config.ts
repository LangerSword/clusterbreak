import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // The sim engine lives outside the frontend root (../sim) and is imported
  // directly from source; allow the dev server to serve it too.
  server: { fs: { allow: [".."] } },
  build: {
    rollupOptions: {
      input: {
        // /            → marketing landing
        // /app.html    → the simulator (rig board, run, break, reports)
        // /docs.html   → documentation
        main: r('./index.html'),
        app: r('./app.html'),
        docs: r('./docs.html'),
      },
    },
  },
})
