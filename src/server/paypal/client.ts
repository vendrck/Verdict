import { randomUUID } from "node:crypto";
import type { PayPalEnv } from "@/config/env";

const BASE_URLS = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
} as const;

/** Refresh the token this long before PayPal says it expires. */
const TOKEN_REFRESH_MARGIN_MS = 60_000;

export class PayPalApiError extends Error {
  constructor(
    readonly status: number,
    readonly debugId: string | undefined,
    readonly issue: string | undefined,
    readonly body: unknown,
  ) {
    super(`PayPal API ${status}${issue ? ` ${issue}` : ""}${debugId ? ` (debug_id ${debugId})` : ""}`);
    this.name = "PayPalApiError";
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /**
   * Sent as PayPal-Request-Id so retries of money-moving calls are idempotent.
   * Pass a stable key (e.g. `capture:<jobId>`) for those calls.
   */
  idempotencyKey?: string;
  /** Ask PayPal to return the full resource instead of a minimal one. */
  preferRepresentation?: boolean;
  headers?: Record<string, string>;
}

type Fetch = typeof fetch;

export class PayPalClient {
  readonly baseUrl: string;
  private token: { value: string; expiresAt: number } | null = null;
  private pendingToken: Promise<string> | null = null;

  constructor(
    private readonly config: Pick<PayPalEnv, "PAYPAL_ENV" | "PAYPAL_CLIENT_ID" | "PAYPAL_CLIENT_SECRET">,
    private readonly fetchImpl: Fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    this.baseUrl = BASE_URLS[config.PAYPAL_ENV];
  }

  /** OAuth2 client-credentials token, cached until shortly before expiry. */
  async getAccessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - TOKEN_REFRESH_MARGIN_MS > this.now()) {
      return this.token.value;
    }
    // Share one in-flight token request between concurrent callers.
    this.pendingToken ??= this.fetchToken().finally(() => {
      this.pendingToken = null;
    });
    return this.pendingToken;
  }

  private async fetchToken(): Promise<string> {
    const basic = Buffer.from(`${this.config.PAYPAL_CLIENT_ID}:${this.config.PAYPAL_CLIENT_SECRET}`).toString("base64");
    const res = await this.fetchImpl(`${this.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (!res.ok || !json.access_token) {
      throw new PayPalApiError(res.status, res.headers.get("paypal-debug-id") ?? undefined, "AUTH_FAILED", json);
    }
    this.token = { value: json.access_token, expiresAt: this.now() + (json.expires_in ?? 0) * 1000 };
    return json.access_token;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = "GET", body, idempotencyKey, preferRepresentation, headers = {} } = options;
    const token = await this.getAccessToken();

    const finalHeaders: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      ...headers,
    };
    if (body !== undefined && !(body instanceof FormData)) {
      finalHeaders["Content-Type"] = "application/json";
    }
    if (method !== "GET") {
      finalHeaders["PayPal-Request-Id"] = idempotencyKey ?? randomUUID();
    }
    if (preferRepresentation) {
      finalHeaders.Prefer = "return=representation";
    }

    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: finalHeaders,
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });

    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const json: unknown = text ? JSON.parse(text) : undefined;

    if (!res.ok) {
      const err = json as { name?: string; details?: { issue?: string }[] } | undefined;
      throw new PayPalApiError(
        res.status,
        res.headers.get("paypal-debug-id") ?? undefined,
        err?.details?.[0]?.issue ?? err?.name,
        json,
      );
    }
    return json as T;
  }
}

let shared: PayPalClient | null = null;

/** Process-wide client so the OAuth token is reused across requests. */
export function getPayPalClient(config: ConstructorParameters<typeof PayPalClient>[0]): PayPalClient {
  shared ??= new PayPalClient(config);
  return shared;
}
