import { handleOpenScadRenderRequest } from './openscad-render.mjs';

/** POST /api/openscad-render on the Vite server. Localhost only. */
export function vitePluginOpenScadRender() {
  return {
    name: 'atom-openscad-render',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        Promise.resolve(handleOpenScadRenderRequest(req, res))
          .then((handled) => {
            if (!handled) next();
          })
          .catch(next);
      });
    },
  };
}
