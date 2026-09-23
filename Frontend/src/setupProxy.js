/*
  Create React App development proxy configuration.
  This forwards API and file requests to the backend while running `npm start`.

  Why add this if package.json already has "proxy": "http://localhost:4000"?
  - On some Windows setups, CRA’s simple proxy can hiccup (IPv6 ::1 vs 127.0.0.1, port binding race, etc.).
  - http-proxy-middleware gives us explicit routes, changeOrigin, and better logs.

  You can override the backend target via one of these environment vars:
  - REACT_APP_BACKEND_URL
  - BACKEND_URL
  - BACKEND_PORT (number; default 4000)
*/

const { createProxyMiddleware } = require('http-proxy-middleware');

function pickTarget() {
  const envUrl =
    process.env.REACT_APP_BACKEND_URL ||
    process.env.BACKEND_URL ||
    '';

  if (envUrl) return envUrl;

  const port = String(process.env.BACKEND_PORT || '4000').replace(/^:+/, '');
  // Prefer 127.0.0.1 to avoid potential IPv6/localhost issues on Windows.
  return `http://127.0.0.1:${port}`;
}

module.exports = function (app) {
  const target = pickTarget();

  // Mount without an Express path and select routes with pathFilter instead.
  // `app.use('/api', middleware)` strips the "/api" prefix before the proxy
  // sees the request, and http-proxy-middleware v3 does not restore it — the
  // backend then receives "/auth/login" and answers 404.
  app.use(
    createProxyMiddleware({
      target,
      changeOrigin: true,
      ws: false,
      secure: false,
      pathFilter: ['/api/**', '/uploads/**', '/files/**'],
      on: {
        // Helpful when debugging proxy issues
        proxyRes: (proxyRes) => {
          proxyRes.headers['x-dev-proxy'] = 'setupProxy.js';
        }
      }
    })
  );
};
