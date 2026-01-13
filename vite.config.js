import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import process from 'node:process'

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  
  const placeholders = {
    'FIREBASE_API_KEY_PLACEHOLDER': env.VITE_FIREBASE_API_KEY || '',
    'FIREBASE_AUTH_DOMAIN_PLACEHOLDER': env.VITE_FIREBASE_AUTH_DOMAIN || '',
    'FIREBASE_DATABASE_URL_PLACEHOLDER': env.VITE_FIREBASE_DATABASE_URL || '',
    'FIREBASE_PROJECT_ID_PLACEHOLDER': env.VITE_FIREBASE_PROJECT_ID || '',
    'FIREBASE_STORAGE_BUCKET_PLACEHOLDER': env.VITE_FIREBASE_STORAGE_BUCKET || '',
    'FIREBASE_MESSAGING_SENDER_ID_PLACEHOLDER': env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
    'FIREBASE_APP_ID_PLACEHOLDER': env.VITE_FIREBASE_APP_ID || '',
  };

  return {
    plugins: [
      react(),
      {
        name: 'service-worker-transformer',
        // Servir en modo desarrollo
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url === '/firebase-messaging-sw.js') {
              const swPath = path.resolve(__dirname, 'src/firebase-messaging-sw.js');
              let content = fs.readFileSync(swPath, 'utf-8');
              Object.entries(placeholders).forEach(([key, value]) => {
                content = content.replace(new RegExp(key, 'g'), value);
              });
              res.setHeader('Content-Type', 'application/javascript');
              res.end(content);
              return;
            }
            next();
          });
        },
        // Generar en modo build
        generateBundle() {
          const swPath = path.resolve(__dirname, 'src/firebase-messaging-sw.js');
          let content = fs.readFileSync(swPath, 'utf-8');
          Object.entries(placeholders).forEach(([key, value]) => {
            content = content.replace(new RegExp(key, 'g'), value);
          });
          this.emitFile({
            type: 'asset',
            fileName: 'firebase-messaging-sw.js',
            source: content
          });
        }
      }
    ],
    define: {
      // También mantenemos define para el resto de la app si se usan los placeholders en el código fuente
      ...Object.fromEntries(Object.entries(placeholders).map(([k, v]) => [k, JSON.stringify(v)]))
    }
  }
})
