import { createClient } from "npm:@supabase/supabase-js@2";
import { GoogleGenAI } from "npm:@google/genai@2";
export const env = (name: string) => Deno.env.get(name) || "";
export const db = () =>
  createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
export const ai = () => new GoogleGenAI({ apiKey: env("GEMINI_API_KEY") });
export const model = () => env("GEMINI_MODEL") || "gemini-3.6-flash";
export const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
export function check<T>({
  data,
  error,
}: {
  data: T;
  error: { message: string } | null;
}): T {
  if (error) throw new Error(error.message);
  return data;
}
export async function authenticate(request: Request) {
  const token = request.headers
    .get("Authorization")
    ?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new Error("UNAUTHORIZED");
  const { data, error } = await db().auth.getUser(token);
  if (error || !data.user) throw new Error("UNAUTHORIZED");
  return data.user;
}
export async function readBody(request: Request, limit = 30 * 1024 * 1024) {
  if (Number(request.headers.get("Content-Length")) > limit)
    throw new Error("Request too large.");
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.byteLength;
    if (length > limit) {
      await reader.cancel();
      throw new Error("Request too large.");
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export async function embed(texts: string[]) {
  const result = await ai().models.embedContent({
    model: "gemini-embedding-001",
    contents: texts,
    config: { outputDimensionality: 768 },
  });
  return result.embeddings?.map((value) => value.values) || [];
}
export function chunks(sections: { text: string; page?: number }[]) {
  return sections.flatMap((section) => {
    const result = [];
    for (let i = 0; i < section.text.length; i += 1800)
      result.push({
        text: section.text.slice(i, i + 2200),
        page: section.page,
      });
    return result;
  });
}
export async function paddle(path: string, method = "GET", body?: unknown) {
  const host =
    env("PADDLE_ENVIRONMENT") === "sandbox"
      ? "https://sandbox-api.paddle.com"
      : "https://api.paddle.com";
  const result = await fetch(host + path, {
    method,
    headers: {
      Authorization: `Bearer ${env("PADDLE_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!result.ok) throw new Error("Billing is temporarily unavailable.");
  return (await result.json()).data;
}
export async function applySubscription(id: string, at: string, data: any) {
  if (!data.custom_data?.quip_user_id) return;
  if (!env("PADDLE_PRICE_ID"))
    throw new Error("Billing price is not configured.");
  if (
    !data.items?.some((item: any) => item.price?.id === env("PADDLE_PRICE_ID"))
  )
    return;
  // Late provider events after account deletion must not recreate an entitlement.
  const owner = check(
    await db()
      .from("profiles")
      .select("id")
      .eq("id", data.custom_data.quip_user_id)
      .maybeSingle(),
  );
  if (!owner) return;
  check(
    await db().rpc("apply_subscription_event", {
      p_event: id,
      p_owner: data.custom_data.quip_user_id,
      p_subscription: data.id,
      p_customer: data.customer_id,
      p_status: data.status,
      p_start: data.current_billing_period?.starts_at || null,
      p_end: data.current_billing_period?.ends_at || null,
      p_at: at,
    }),
  );
}
