import app, { ensureBackendReady } from "../src/server.js";

function applyOpenCorsHeaders(req: any, res: any) {
  const requestedHeaders = req?.headers?.["access-control-request-headers"];
  const allowHeaders = Array.isArray(requestedHeaders)
    ? requestedHeaders.join(",")
    : requestedHeaders ||
      "Origin, X-Requested-With, Content-Type, Accept, Authorization";

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", allowHeaders);
}

export default async function handler(req: any, res: any) {
  applyOpenCorsHeaders(req, res);

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
