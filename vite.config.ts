import { defineConfig } from 'vite';
import { gameServer } from './server/vite.ts';

export default defineConfig({
  plugins: [gameServer()],
  server: {
    fs: {
      // Retain Vite's credential-file defaults and keep private generation responses
      // (which contain temporary asset URLs) outside the development server's routes.
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.local/**'],
    },
  },
});
