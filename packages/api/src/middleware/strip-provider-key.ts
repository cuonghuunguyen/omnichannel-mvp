// Express middleware that reads and strips the X-Provider-Key header before any
// logger or body-parser has a chance to capture it. The raw decrypted BYOK
// provider key is then available on `res.locals.providerApiKey` for the
// duration of the request only — it is never persisted or logged (D-12 / T-35-03).
import type { Request, Response, NextFunction } from "express";

/**
 * Strip the X-Provider-Key header from the incoming request and store its value
 * on `res.locals.providerApiKey`. Must be registered BEFORE any logger or route
 * handler so the key is never captured in access logs or request dumps.
 */
export function stripProviderKey(req: Request, res: Response, next: NextFunction): void {
  res.locals.providerApiKey = req.header("x-provider-key") || undefined;
  delete req.headers["x-provider-key"]; // strip before any access-logger runs
  next();
}
