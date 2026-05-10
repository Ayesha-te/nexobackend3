import app, { ensureBackendReady } from "../src/server.js";

function applyOpenCorsHeaders(req: any, res: any) {
  const origin = req.headers.origin || "*";
  
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, PUT, PATCH, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Vary", "Origin");
}

export default async function handler(req: any, res: any) {
  // Apply CORS headers to all responses
  applyOpenCorsHeaders(req, res);

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    await ensureBackendReady();
    return app(req, res);
  } catch (error) {
    console.error("Backend request failed before routing:", error);

    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          message:
            error instanceof Error
              ? error.message
              : "Backend startup failed before the request could be handled.",
        }),
      );
    }
  }
}
