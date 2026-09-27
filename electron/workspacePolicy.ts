import { z } from "zod";
export const idSchema = z.string().uuid();
const shortText = z.string().trim().min(1).max(160);
export const projectSchema = z
  .object({
    id: idSchema,
    name: shortText,
    instructions: z.string().max(8000),
    updatedAt: z.string().datetime(),
  })
  .strict();
export const conversationSchema = z
  .object({
    id: idSchema,
    projectId: idSchema,
    title: shortText,
    updatedAt: z.string().datetime(),
  })
  .strict();
export const outputSchema = z
  .object({
    id: idSchema,
    projectId: idSchema,
    title: shortText,
    text: z.string().max(100000),
    updatedAt: z.string().datetime(),
  })
  .strict();
export const generationSchema = z
  .object({
    requestId: idSchema,
    conversationId: idSchema,
    text: z.string().trim().min(1).max(24000),
    attachmentIds: z.array(idSchema).max(4),
    sourceIds: z.array(idSchema).max(20),
  })
  .strict();
export function trustedRenderer(senderUrl: string, packaged: boolean): boolean {
  try {
    const url = new URL(senderUrl);
    return packaged
      ? url.protocol === "file:" && url.pathname.endsWith("/dist/index.html")
      : url.origin === "http://localhost:5180";
  } catch {
    return false;
  }
}
export function safeBillingUrl(raw: unknown): string {
  if (typeof raw !== "string") throw new Error("Billing is unavailable.");
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    ![
      "pay.paddle.io",
      "sandbox-pay.paddle.io",
      "checkout.paddle.com",
      "sandbox-checkout.paddle.com",
      "customer-portal.paddle.com",
      "sandbox-customer-portal.paddle.com",
    ].includes(url.hostname)
  )
    throw new Error("Untrusted billing address.");
  return url.href;
}
export function normalizeCrop(
  rect: { x: number; y: number; width: number; height: number },
  width: number,
  height: number,
) {
  const values = Object.values(rect);
  if (
    values.some((v) => !Number.isFinite(v)) ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.x < 0 ||
    rect.y < 0 ||
    rect.x + rect.width > 1.001 ||
    rect.y + rect.height > 1.001
  )
    throw new Error("Select a region inside the image.");
  const left = Math.floor(rect.x * width),
    top = Math.floor(rect.y * height);
  return {
    left,
    top,
    width: Math.max(1, Math.min(width - left, Math.round(rect.width * width))),
    height: Math.max(
      1,
      Math.min(height - top, Math.round(rect.height * height)),
    ),
  };
}
