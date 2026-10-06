import { createDesktopHost, handleDesktopHostRequest } from './desktop-host-lib.mjs';

export function vitePluginDesktopHost() {
  const host = createDesktopHost();
  return {
    name: 'atom-desktop-host',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        Promise.resolve(handleDesktopHostRequest(host, req, res, next)).catch(next);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        Promise.resolve(handleDesktopHostRequest(host, req, res, next)).catch(next);
      });
    },
  };
}
