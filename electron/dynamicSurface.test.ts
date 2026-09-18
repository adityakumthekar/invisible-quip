import { describe, expect, it } from "vitest";
import { generatedSurfaceSchema, responsibilitySchema } from "./companionContract";
const surface = { title: "Research comparison", answer: "Choose based on your constraints.", blocks: [{ kind: "comparison", id: "options", title: "Compare", columns: ["Option", "Cost"], rows: [{ id: "a", cells: ["A", "$10"] }] }] };
describe("generated interfaces", () => {
  it("accepts a useful typed comparison", () => { expect(generatedSurfaceSchema.parse(surface).blocks[0].kind).toBe("comparison"); });
  it("rejects scripts, invented commands, unknown blocks, and duplicate identity", () => {
    expect(generatedSurfaceSchema.safeParse({ ...surface, script: "fetch('/private')" }).success).toBe(false);
    expect(generatedSurfaceSchema.safeParse({ ...surface, blocks: [{ ...surface.blocks[0], onClick: "delete-all" }] }).success).toBe(false);
    expect(generatedSurfaceSchema.safeParse({ ...surface, blocks: [{ kind: "iframe", id: "x", title: "Embedded", src: "https://example.test" }] }).success).toBe(false);
    expect(generatedSurfaceSchema.safeParse({ ...surface, blocks: [surface.blocks[0], surface.blocks[0]] }).success).toBe(false);
  });
  it("rejects mismatched table dimensions", () => { expect(generatedSurfaceSchema.safeParse({ ...surface, blocks: [{ ...surface.blocks[0], columns: ["Only one"] }] }).success).toBe(false); });
  it("requires explicit bounded permissions for responsibilities", () => {
    expect(responsibilitySchema.safeParse({ id: "test", title: "Task", goal: "Run", enabled: true, trigger: { kind: "schedule", everyMinutes: 1, nextAt: "tomorrow" }, authority: { apps: [], targets: [], actions: ["execute-shell"], maxSteps: Infinity, maxMinutes: 0 } }).success).toBe(false);
  });
});
