import { describe, expect, it } from "vitest";
import {
  generationSchema,
  normalizeCrop,
  safeBillingUrl,
  trustedRenderer,
} from "./workspacePolicy";
import { verifyPaddleSignature } from "../supabase/functions/_shared/billingSignature";
import { createHmac, randomUUID } from "node:crypto";
describe("workspace boundaries", () => {
  it("rejects foreign renderers and executable billing URLs", () => {
    expect(trustedRenderer("https://attacker.test/dist/index.html", true)).toBe(
      false,
    );
    expect(trustedRenderer("http://localhost:5180.attacker.test", false)).toBe(
      false,
    );
    expect(
      trustedRenderer(
        "file:///Applications/Quip.app/Contents/Resources/app.asar/dist/index.html",
        true,
      ),
    ).toBe(true);
    expect(() => safeBillingUrl("javascript:alert(1)")).toThrow();
    expect(() =>
      safeBillingUrl("https://customer-portal.paddle.com.attacker.test"),
    ).toThrow();
    expect(safeBillingUrl("https://pay.paddle.io/checkout/test")).toContain(
      "pay.paddle.io",
    );
  });
  it("rejects oversized or malformed generation contexts", () => {
    expect(() =>
      generationSchema.parse({
        requestId: randomUUID(),
        conversationId: randomUUID(),
        text: "x".repeat(24001),
        attachmentIds: [],
        sourceIds: [],
      }),
    ).toThrow();
    expect(() =>
      generationSchema.parse({
        requestId: "../file",
        conversationId: randomUUID(),
        text: "hello",
        attachmentIds: [],
        sourceIds: [],
      }),
    ).toThrow();
  });
  it("keeps a crop inside actual pixels and rejects out-of-range input", () => {
    expect(
      normalizeCrop({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, 2000, 1000),
    ).toEqual({ left: 500, top: 250, width: 1000, height: 500 });
    expect(() =>
      normalizeCrop({ x: -1, y: 0, width: 0.5, height: 0.5 }, 100, 100),
    ).toThrow();
    expect(() =>
      normalizeCrop({ x: 0, y: 0, width: NaN, height: 1 }, 100, 100),
    ).toThrow();
  });
  it("accepts authentic webhooks while rejecting tampering, replay and missing secrets", async () => {
    const now = Date.now(),
      ts = Math.floor(now / 1000),
      body = '{"event_id":"evt_1"}',
      secret = "test-secret",
      signature = createHmac("sha256", secret)
        .update(`${ts}:${body}`)
        .digest("hex"),
      header = `ts=${ts};h1=${signature}`;
    expect(await verifyPaddleSignature(body, header, secret, now)).toBe(true);
    expect(await verifyPaddleSignature(body + " ", header, secret, now)).toBe(
      false,
    );
    expect(
      await verifyPaddleSignature(body, header, secret, now + 301000),
    ).toBe(false);
    expect(await verifyPaddleSignature(body, header, "", now)).toBe(false);
  });
});
