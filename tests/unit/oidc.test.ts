import { describe, expect, it } from "vitest";
import { AuthError } from "@/services/auth";
import {
  assertEmailAllowed,
  isGoogleIssuer,
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

describe("Okta compatibility", () => {
  const common = {
    clientId: "0oa1okta",
    redirectUri: "https://utm-builder-runpod.vercel.app/api/auth/callback",
    state: "s1",
    nonce: "n1",
    loginHintDomain: "runpod.io",
  };

  it("detects Google vs other issuers", () => {
    expect(isGoogleIssuer("https://accounts.google.com")).toBe(true);
    expect(isGoogleIssuer("accounts.google.com")).toBe(true);
    expect(isGoogleIssuer("https://runpod.okta.com")).toBe(false);
    expect(isGoogleIssuer("https://runpod.okta.com/oauth2/default")).toBe(false);
  });

  it("omits Google-only prompt/hd params for an Okta issuer", () => {
    const url = new URL(
      buildAuthorizationUrl({
        ...common,
        authorizationEndpoint: "https://runpod.okta.com/oauth2/v1/authorize",
        issuer: "https://runpod.okta.com",
      }),
    );
    expect(url.searchParams.get("prompt")).toBeNull();
    expect(url.searchParams.get("hd")).toBeNull();
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("response_type")).toBe("code");
  });

  it("still sends prompt/hd for Google", () => {
    const url = new URL(
      buildAuthorizationUrl({
        ...common,
        authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
        issuer: "https://accounts.google.com",
      }),
    );
    expect(url.searchParams.get("prompt")).toBe("select_account");
    expect(url.searchParams.get("hd")).toBe("runpod.io");
  });

  it("accepts a thin id_token (no email) only when allowMissingEmail is set", () => {
    const thin = { ...baseClaims, email: undefined, sub: "00u123", iss: "https://runpod.okta.com" };
    const okta = { ...expected, issuer: "https://runpod.okta.com" };
    expect(() => validateIdTokenClaims(thin, okta)).toThrow(AuthError);
    const identity = validateIdTokenClaims(thin, { ...okta, allowMissingEmail: true });
    expect(identity.email).toBeNull();
    expect(identity.sub).toBe("00u123");
  });

  it("applies the same email policy to userinfo-derived emails", () => {
    expect(assertEmailAllowed("Ken@Runpod.io", true, ["runpod.io"])).toBe("ken@runpod.io");
    expect(() => assertEmailAllowed("x@gmail.com", true, ["runpod.io"])).toThrow(AuthError);
    expect(() => assertEmailAllowed("ken@runpod.io", false, ["runpod.io"])).toThrow(AuthError);
    expect(() => assertEmailAllowed(undefined, true, ["runpod.io"])).toThrow(AuthError);
  });
});
