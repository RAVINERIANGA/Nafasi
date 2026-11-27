import { subscribe } from "@/server/realtime/hub";
import { handle } from "@/server/http/router";
import { readDb } from "@/server/core/store";
import "@/server/realtime/tick";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function dispatch(method: string, req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (method === "GET" && path.join("/") === "events") return events(req);
  return handle(method, path, req);
}

function events(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  const known = token && readDb().sessions.some((session) => session.token === token);
  if (!known) return Response.json({ error: { code: "AUTH_REQUIRED", message: "Sign in to continue." } }, { status: 401 });
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      send("ready", { simulated: true, note: "Simulated event stream. Not a live hospital channel." });
      const unsubscribe = subscribe((event) => send(event.type, event));
      const ping = setInterval(() => send("ping", {}), 15000);
      cleanup = () => {
        clearInterval(ping);
        unsubscribe();
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
    },
  });
}

export function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return dispatch("GET", req, ctx);
}
export function POST(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return dispatch("POST", req, ctx);
}
export function PUT(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return dispatch("PUT", req, ctx);
}
export function PATCH(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return dispatch("PATCH", req, ctx);
}
