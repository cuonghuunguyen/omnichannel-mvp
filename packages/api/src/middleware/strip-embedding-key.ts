// Express middleware that reads and strips the X-Embedding-Key header before any
// logger or body-parser has a chance to capture it. The raw decrypted BYOK
// embedding key is then available on `res.locals.embeddingApiKey` for the
// duration of the request only — it is never persisted or logged (D-02 / T-37-02-01).
import type { Request, Response, NextFunction } from "express";

/**
 * Strip the X-Embedding-Key header from the incoming request and store its value
 * on `res.locals.embeddingApiKey`. Must be registered BEFORE any logger or route
 * handler so the key is never captured in access logs or request dumps.
 */
export function stripEmbeddingKey(req: Request, res: Response, next: NextFunction): void {
  res.locals.embeddingApiKey = req.header("x-embedding-key") || undefined;
  delete req.headers["x-embedding-key"]; // strip before any access-logger runs
  next();
}
