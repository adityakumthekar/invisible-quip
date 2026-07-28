// Public renderer entrypoint for the shared autopilot contract.
// Both modules are pure TypeScript with no Electron imports, so the renderer
// can consume them directly — same arrangement as lib/teaching.ts.
export * from "../../electron/autopilot"
export * from "../../electron/autopilotPolicy"
