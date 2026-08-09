import { describe, expect, it } from "vitest"
import path from "node:path"
import {
  bearerToken,
  contentTypeFor,
  findLanAddress,
  isSameOrigin,
  resolveStaticPath
} from "./remoteHttp"

const ROOT = "/app/dist-remote"

describe("resolveStaticPath", () => {
  it("maps / to index.html", () => {
    expect(resolveStaticPath(ROOT, "/")).toBe(path.resolve(ROOT, "index.html"))
  })

  it("resolves a nested asset", () => {
    expect(resolveStaticPath(ROOT, "/assets/app.js")).toBe(
      path.resolve(ROOT, "assets/app.js")
    )
  })

  // The hole this function exists to close: the process can read the user's
  // whole home directory, so an escape is a file-disclosure bug.
  it("refuses traversal out of the root", () => {
    for (const attack of [
      "/../../../etc/passwd",
      "/..%2f..%2f..%2fetc%2fpasswd",
      "/assets/../../secrets.json",
      "/%2e%2e/%2e%2e/etc/passwd",
      "//../../etc/passwd"
    ]) {
      expect(resolveStaticPath(ROOT, attack)).toBeNull()
    }
  })

  it("refuses a null byte", () => {
    expect(resolveStaticPath(ROOT, "/index.html%00.png")).toBeNull()
  })

  it("refuses malformed percent-encoding", () => {
    expect(resolveStaticPath(ROOT, "/%zz")).toBeNull()
  })

  it("does not escape via a sibling directory with a shared prefix", () => {
    expect(resolveStaticPath("/app/dist", "/../dist-remote/index.html")).toBeNull()
  })

  it("keeps an inner path that merely contains dots", () => {
    expect(resolveStaticPath(ROOT, "/assets/app.min.js")).toBe(
      path.resolve(ROOT, "assets/app.min.js")
    )
  })
})

describe("bearerToken", () => {
  it("extracts the token", () => {
    expect(bearerToken("Bearer abc123")).toBe("abc123")
  })

  it("rejects other schemes and malformed headers", () => {
    for (const header of [
      undefined,
      "",
      "abc123",
      "Basic abc123",
      "bearer abc123",
      "Bearer",
      "Bearer "
    ]) {
      expect(bearerToken(header)).toBeNull()
    }
  })
})

describe("isSameOrigin", () => {
  it("allows a request with no Origin (curl, first load)", () => {
    expect(isSameOrigin(undefined, "192.168.1.5:41777")).toBe(true)
  })

  it("allows a matching origin", () => {
    expect(
      isSameOrigin("http://192.168.1.5:41777", "192.168.1.5:41777")
    ).toBe(true)
  })

  it("rejects a different host or port", () => {
    expect(isSameOrigin("http://evil.example", "192.168.1.5:41777")).toBe(false)
    expect(
      isSameOrigin("http://192.168.1.5:8080", "192.168.1.5:41777")
    ).toBe(false)
  })

  it("rejects a malformed origin or missing host", () => {
    expect(isSameOrigin("not a url", "192.168.1.5:41777")).toBe(false)
    expect(isSameOrigin("http://192.168.1.5:41777", undefined)).toBe(false)
  })
})

describe("findLanAddress", () => {
  it("skips loopback and picks the first external IPv4", () => {
    expect(
      findLanAddress({
        lo0: [
          {
            address: "127.0.0.1",
            family: "IPv4",
            internal: true
          } as never
        ],
        en0: [
          {
            address: "192.168.1.5",
            family: "IPv4",
            internal: false
          } as never
        ]
      })
    ).toBe("192.168.1.5")
  })

  it("skips IPv6", () => {
    expect(
      findLanAddress({
        en0: [
          { address: "fe80::1", family: "IPv6", internal: false } as never,
          { address: "10.0.0.4", family: "IPv4", internal: false } as never
        ]
      })
    ).toBe("10.0.0.4")
  })

  it("returns null when there is no external address", () => {
    expect(findLanAddress({})).toBeNull()
    expect(
      findLanAddress({
        lo0: [
          { address: "127.0.0.1", family: "IPv4", internal: true } as never
        ]
      })
    ).toBeNull()
  })
})

describe("contentTypeFor", () => {
  it("maps known extensions", () => {
    expect(contentTypeFor("/x/index.html")).toBe("text/html; charset=utf-8")
    expect(contentTypeFor("/x/app.JS")).toBe("text/javascript; charset=utf-8")
  })

  it("falls back for unknown extensions", () => {
    expect(contentTypeFor("/x/thing.bin")).toBe("application/octet-stream")
  })
})
