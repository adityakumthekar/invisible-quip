export async function verifyPaddleSignature(
  body: string,
  header: string,
  secret: string,
  now = Date.now(),
): Promise<boolean> {
  if (!secret) return false;
  const pairs = header.split(";").map((part) => part.trim().split("="));
  const timestamp = pairs.find(([key]) => key === "ts")?.[1];
  const signatures = pairs
    .filter(([key]) => key === "h1")
    .map(([, value]) => value);
  if (
    !timestamp ||
    !/^\d+$/.test(timestamp) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300
  )
    return false;
  const encoder = new TextEncoder(),
    key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
  for (const signature of signatures) {
    if (!/^[a-f0-9]{64}$/i.test(signature)) continue;
    const bytes = Uint8Array.from(
      signature.match(/../g)!.map((pair) => parseInt(pair, 16)),
    );
    if (
      await crypto.subtle.verify(
        "HMAC",
        key,
        bytes,
        encoder.encode(`${timestamp}:${body}`),
      )
    )
      return true;
  }
  return false;
}
