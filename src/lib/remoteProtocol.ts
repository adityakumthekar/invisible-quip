// Public renderer/phone entrypoint for the shared remote protocol contract.
// Pure TypeScript with no Electron imports, so both clients get exactly the
// types the server validates against — same arrangement as lib/autopilot.ts.
export * from "../../electron/remoteProtocol"
