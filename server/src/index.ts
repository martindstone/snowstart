import { createApp } from "./app.js";

// Development entry: the relay on its own, called by the Vite dev server (which also proxies /api to it).
const PORT = Number(process.env.PORT) || 4000;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "http://localhost:5173";

createApp({ allowedOrigins: [ALLOWED_ORIGIN] }).listen(PORT, "127.0.0.1", () => {
  console.log(`snowstart relay listening on http://127.0.0.1:${PORT} (allowed origin: ${ALLOWED_ORIGIN})`);
});
