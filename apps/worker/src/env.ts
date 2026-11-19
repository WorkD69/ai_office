/** Bindings and secrets available to the Worker (see wrangler.jsonc). */
export interface Env {
  OFFICE: DurableObjectNamespace;
  ASSETS: Fetcher;
  BOT_TOKEN: string;
  OWNER_TELEGRAM_ID: string;
  COLLECTOR_TOKEN: string;
  SESSION_SECRET: string;
}
