import type { Plugin } from 'vite';
import type { Server } from 'node:http';
import { createApp } from './app.ts';
import { serverSettings } from './config.ts';
export function gameServer(): Plugin {
  return { name: 'warchog-game-server',
    configureServer(server) {
      const app = createApp(serverSettings());
      server.middlewares.use((req,res,next) => { void app.handle(req,res).then(handled => { if (!handled) next(); }).catch(next); });
      if (server.httpServer) { app.attach(server.httpServer as Server); server.httpServer.once('close', () => app.close()); }
    },
    configurePreviewServer(server) {
      const app = createApp(serverSettings());
      server.middlewares.use((req,res,next) => { void app.handle(req,res).then(handled => { if (!handled) next(); }).catch(next); });
      app.attach(server.httpServer as Server); server.httpServer.once('close', () => app.close());
    },
  };
}
