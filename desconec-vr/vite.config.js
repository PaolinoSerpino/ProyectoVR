import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run dev:https` sirve por HTTPS en la red local: WebXR exige un contexto seguro
// para abrir la experiencia desde el navegador del casco (Quest, Pico, etc.).
export default defineConfig(({ mode }) => ({
  plugins: mode === 'https' ? [basicSsl()] : [],
  server: { host: mode === 'https' },
  build: { target: 'es2022', chunkSizeWarningLimit: 6000 }
}));
