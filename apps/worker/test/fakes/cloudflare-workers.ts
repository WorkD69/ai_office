/** Minimal stand-in for the `cloudflare:workers` module so the Durable Object runs under Node. */
export class DurableObject<Env = unknown> {
  constructor(
    protected readonly ctx: DurableObjectState,
    protected readonly env: Env,
  ) {}
}
