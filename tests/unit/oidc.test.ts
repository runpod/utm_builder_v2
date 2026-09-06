import { describe, expect, it } from "vitest";
import { AuthError } from "@/services/auth";
import {
  buildAuthorizationUrl,
  createSessionCookieValue,
  decodeJwtPayload,
  newStateAndNonce,
  parseStateCookie,
  validateIdTokenClaims,
  verifySessionCookieValue,
} from "@/services/oidc";

const SECRET = "test-session-secret-at-least-32-chars!!";
const NOW = 1_800_000_000;

const baseClaims = {
  iss: "https://accounts.google.com",
  aud: "client-123",
  exp: NOW + 600,
  nonce: "nonce-abc",
  email: "Ken@Runpod.io",
  email_verified: true,
  name: "Ken",
};

const expected = {
  issuer: "https://accounts.google.com",
  clientId: "client-123",
  nonce: "nonce-abc",
  allowedDomains: ["runpod.io"],
  nowSeconds: NOW,
};

describe("id_token claim validation", () => {
  it("accepts a valid Google token and normalizes the email", () => {
    const result = validateIdTokenClaims(baseClaims, expected);
    expect(result.email).toBe("ken@runpod.io");
  });

  it("accepts issuer without https prefix (Google legacy form)", () => {
    expect(
      validateIdTokenClaims({ ...baseClaims, iss: "accounts.google.com" }, expected).email,
    ).toBe("ken@runpod.io");
  });

  it.each([
    ["wrong issuer", { iss: "https://evil.example" }],
    ["wrong audience", { aud: "other-client" }],
    ["expired", { exp: NOW - 1 }],
    ["nonce mismatch", { nonce: "other-nonce" }],
    ["unverified email", { email_verified: false }],
    ["missing email", { email: undefined }],
    ["disallowed domain", { email: "someone@gmail.com" }],
  ])("rejects %s", (_label, patch) => {
    expect(() => validateIdTokenClaims({ ...baseClaims, ...patch }, expected)).toThrow(AuthError);
  });

  it("allows any domain when the allowlist is empty", () => {
    expect(
      validateIdTokenClaims({ ...baseClaims, email: "x@example.com" }, { ...expected, allowedDomains: [] }).email,
    ).toBe("x@example.com");
  });
});

describe("session cookie", () => {
  it("round-trips and lowercases the email", () => {
    const value = createSessionCookieValue("Ken@Runpod.io", { nowSeconds: NOW, secret: SECRET });
    expect(verifySessionCookieValue(value, { nowSeconds: NOW + 100, secret: SECRET })).toBe(
      "ken@runpod.io",
    );
  });

  it("rejects expiry, tampering, and wrong secrets", () => {
    const value = createSessionCookieValue("ken@runpod.io", { nowSeconds: NOW, secret: SECRET });
    expect(
      verifySessionCookieValue(value, { nowSeconds: NOW + 13 * 3600, secret: SECRET }),
    ).toBeNull();
    expect(verifySessionCookieValue(value, { nowSeconds: NOW, secret: SECRET + "x" })).toBeNull();
    const parts = value.split(".");
    parts[2] = Buffer.from("attacker@runpod.io").toString("base64url");
    expect(
      verifySessionCookieValue(parts.join("."), { nowSeconds: NOW, secret: SECRET }),
    ).toBeNull();
    expect(verifySessionCookieValue(undefined, { nowSeconds: NOW, secret: SECRET })).toBeNull();
    expect(verifySessionCookieValue("v1.garbage", { nowSeconds: NOW, secret: SECRET })).toBeNull();
  });
});

describe("state/nonce and authorization URL", () => {
  it("state cookie round-trips", () => {
    const { state, nonce, cookieValue } = newStateAndNonce();
    expect(parseStateCookie(cookieValue)).toEqual({ state, nonce });
    expect(parseStateCookie(undefined)).toBeNull();
    expect(parseStateCookie("missing-parts")).toBeNull();
  });

  it("builds the authorization URL with required parameters", () => {
    const url = new URL(
      buildAuthorizationUrl({
        authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
        clientId: "client-123",
        redirectUri: "https://utm.runpod.io/api/auth/callback",
        state: "s1",
        nonce: "n1",
        loginHintDomain: "runpod.io",
      }),
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("redirect_uri")).toBe("https://utm.runpod.io/api/auth/callback");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("state")).toBe("s1");
    expect(url.searchParams.get("nonce")).toBe("n1");
    expect(url.searchParams.get("hd")).toBe("runpod.io");
  });
});

describe("jwt decoding", () => {
  it("decodes a payload and rejects non-JWTs", () => {
    const payload = Buffer.from(JSON.stringify({ email: "a@b.co" })).toString("base64url");
    expect(decodeJwtPayload(`h.${payload}.s`).email).toBe("a@b.co");
    expect(() => decodeJwtPayload("not-a-jwt")).toThrow(AuthError);
  });
});
