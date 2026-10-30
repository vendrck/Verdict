import { describe, expect, it, vi } from "vitest";
import { PayPalApiError, PayPalClient } from "@/server/paypal/client";

const config = { PAYPAL_ENV: "sandbox", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" } as const;

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function mockFetch(handler: (url: string, init: RequestInit) => Response) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => handler(String(input), init ?? {}));
}

describe("PayPalClient", () => {
  it("uses the sandbox base URL and caches the OAuth token", async () => {
    const fetchImpl = mockFetch((url) =>
      url.endsWith("/v1/oauth2/token") ? jsonResponse({ access_token: "tok", expires_in: 3600 }) : jsonResponse({ ok: 1 }),
    );
    const client = new PayPalClient(config, fetchImpl);

    await client.request("/v2/checkout/orders/1");
    await client.request("/v2/checkout/orders/2");

    expect(client.baseUrl).toBe("https://api-m.sandbox.paypal.com");
    const tokenCalls = fetchImpl.mock.calls.filter(([url]) => String(url).endsWith("/v1/oauth2/token"));
    expect(tokenCalls).toHaveLength(1);
  });

  it("refreshes the token shortly before it expires", async () => {
    let now = 0;
    const fetchImpl = mockFetch(() => jsonResponse({ access_token: "tok", expires_in: 120 }));
    const client = new PayPalClient(config, fetchImpl, () => now);

    await client.getAccessToken();
    now = 30_000;
    await client.getAccessToken(); // still valid
    now = 61_000;
    await client.getAccessToken(); // inside the 60s refresh margin
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("sends the idempotency key as PayPal-Request-Id on writes", async () => {
    const fetchImpl = mockFetch((url) =>
      url.endsWith("/v1/oauth2/token") ? jsonResponse({ access_token: "tok", expires_in: 3600 }) : jsonResponse({}),
    );
    const client = new PayPalClient(config, fetchImpl);

    await client.request("/v2/payments/authorizations/A/capture", {
      method: "POST",
      body: {},
      idempotencyKey: "capture:job-1",
    });

    const [, init] = fetchImpl.mock.calls.at(-1)!;
    const headers = init!.headers as Record<string, string>;
    expect(headers["PayPal-Request-Id"]).toBe("capture:job-1");
    expect(headers.Authorization).toBe("Bearer tok");
  });

  it("turns PayPal errors into PayPalApiError with issue and debug id", async () => {
    const fetchImpl = mockFetch((url) =>
      url.endsWith("/v1/oauth2/token")
        ? jsonResponse({ access_token: "tok", expires_in: 3600 })
        : jsonResponse(
            { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "AUTHORIZATION_EXPIRED" }] },
            422,
            { "paypal-debug-id": "dbg123" },
          ),
    );
    const client = new PayPalClient(config, fetchImpl);

    const error = await client.request("/x", { method: "POST", body: {} }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PayPalApiError);
    expect(error).toMatchObject({ status: 422, issue: "AUTHORIZATION_EXPIRED", debugId: "dbg123" });
  });

  it("fails clearly on bad credentials", async () => {
    const fetchImpl = mockFetch(() => jsonResponse({ error: "invalid_client" }, 401));
    const client = new PayPalClient(config, fetchImpl);
    await expect(client.getAccessToken()).rejects.toMatchObject({ status: 401, issue: "AUTH_FAILED" });
  });
});
