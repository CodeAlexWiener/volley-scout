import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { scoutApi } from './server/api.ts'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const root = process.cwd()
  // '' prefix: read every key from .env, server side only (never sent to the browser).
  const env = loadEnv(mode, root, '')
  return {
    plugins: [react(), scoutApi(root, env)],
    server: {
      // Matches and the uploaded video copy change while scouting; don't reload the page.
      watch: { ignored: ['**/matches/**', '**/.cache/**'] },
    },
  }
})
