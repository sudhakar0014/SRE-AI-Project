/** Durable Object for per-incident coordination and a bounded recent-message buffer. */
export class IncidentSession {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/state") {
      return Response.json({ messages: (await this.ctx.storage.get("messages")) || [] });
    }
    if (request.method === "POST" && url.pathname === "/message") {
      const body = await request.json();
      const message = {
        role: body.role === "assistant" ? "assistant" : "user",
        content: String(body.content || "").slice(0, 12000),
        createdAt: new Date().toISOString()
      };
      const messages = (await this.ctx.storage.get("messages")) || [];
      messages.push(message);
      await this.ctx.storage.put("messages", messages.slice(-24));
      return Response.json({ ok: true, count: Math.min(messages.length, 24) });
    }
    if (request.method === "DELETE" && url.pathname === "/state") {
      await this.ctx.storage.deleteAll();
      return Response.json({ ok: true });
    }
    return new Response("Not found", { status: 404 });
  }
}
