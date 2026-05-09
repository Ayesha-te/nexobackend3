import app, { ensureBackendReady } from "../src/server.js";

export default async function handler(req: any, res: any) {
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
