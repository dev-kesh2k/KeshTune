import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:3999' } },
  build: {
    rollupOptions: {
      // React e o roteador mudam pouco: ficam num arquivo próprio, que o navegador mantém em cache entre versões
      output: { manualChunks: { react: ['react', 'react-dom', 'react-router-dom'] } },
    },
  },
});
