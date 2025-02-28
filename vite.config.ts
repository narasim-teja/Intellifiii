import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  define: {
    'process.env': {
      NODE_ENV: JSON.stringify(process.env.NODE_ENV),
      DYNAMIC_ENVIRONMENT_ID: JSON.stringify('848fbc8b-6287-4ef8-ad0e-558dd40a06f6'),
    },
    global: {},
  },
  resolve: {
    alias: {
      process: 'process/browser',
      util: 'util',
    },
  },
  optimizeDeps: {
    exclude: ['@tensorflow/tfjs-node'],
  },
  build: {
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  server: {
    // Using HTTP for local development
    // localhost is considered secure for camera access
    host: 'localhost',
  },
})
