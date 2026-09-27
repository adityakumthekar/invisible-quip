import { applySubscription, env, json } from "../_shared/runtime.ts";
import { verifyPaddleSignature } from "../_shared/billingSignature.ts";
Deno.serve(async (request) => {
  if (request.method !== "POST")
    return json({ error: "Method not allowed" }, 405);
  if (Number(request.headers.get("Content-Length")) > 1048576)
    return json({ error: "Too large" }, 413);
  const body = await request.text();
  if (
    body.length > 1048576 ||
    !(await verifyPaddleSignature(
      body,
      request.headers.get("Paddle-Signature") || "",
      env("PADDLE_WEBHOOK_SECRET"),
    ))
  )
    return json({ error: "Invalid signature" }, 401);
  try {
    const event = JSON.parse(body);
    if (
      typeof event.event_type === "string" &&
      event.event_type.startsWith("subscription.")
    )
      await applySubscription(event.event_id, event.occurred_at, event.data);
    return json({ ok: true });
  } catch {
    return json({ error: "Webhook could not be applied" }, 500);
  }
});
