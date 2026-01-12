import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  
  return {
    plugins: [react()],
    define: {
      'FIREBASE_API_KEY_PLACEHOLDER': JSON.stringify(env.VITE_FIREBASE_API_KEY),
      'FIREBASE_AUTH_DOMAIN_PLACEHOLDER': JSON.stringify(env.VITE_FIREBASE_AUTH_DOMAIN),
      'FIREBASE_DATABASE_URL_PLACEHOLDER': JSON.stringify(env.VITE_FIREBASE_DATABASE_URL),
      'FIREBASE_PROJECT_ID_PLACEHOLDER': JSON.stringify(env.VITE_FIREBASE_PROJECT_ID),
      'FIREBASE_STORAGE_BUCKET_PLACEHOLDER': JSON.stringify(env.VITE_FIREBASE_STORAGE_BUCKET),
      'FIREBASE_MESSAGING_SENDER_ID_PLACEHOLDER': JSON.stringify(env.VITE_FIREBASE_MESSAGING_SENDER_ID),
      'FIREBASE_APP_ID_PLACEHOLDER': JSON.stringify(env.VITE_FIREBASE_APP_ID),
    }
  }
})
