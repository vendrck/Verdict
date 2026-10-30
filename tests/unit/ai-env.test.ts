import { afterEach, describe, expect, it, vi } from "vitest";
import { aiEnv } from "@/config/env";
import { createModel } from "@/server/ai/model";

const VARS = ["AI_PROVIDER", "AI_MODEL", "GOOGLE_GENERATIVE_AI_API_KEY", "ANTHROPIC_API_KEY"] as const;

function setEnv(values: Partial<Record<(typeof VARS)[number], string>>) {
  for (const name of VARS) vi.stubEnv(name, values[name] ?? "");
}

afterEach(() => vi.unstubAllEnvs());

describe("aiEnv", () => {
  it("defaults to Google with the default model", () => {
    setEnv({ GOOGLE_GENERATIVE_AI_API_KEY: "g-key" });
    expect(aiEnv()).toEqual({ provider: "google", model: "gemini-flash-latest", apiKey: "g-key" });
  });

  it("switches to Anthropic and honours AI_MODEL", () => {
    setEnv({ AI_PROVIDER: "anthropic", AI_MODEL: "claude-sonnet-5-5", ANTHROPIC_API_KEY: "a-key" });
    expect(aiEnv()).toEqual({ provider: "anthropic", model: "claude-sonnet-5-5", apiKey: "a-key" });
  });

  it("requires the key of the selected provider only", () => {
    setEnv({ AI_PROVIDER: "anthropic", GOOGLE_GENERATIVE_AI_API_KEY: "g-key" });
    expect(() => aiEnv()).toThrow(/ANTHROPIC_API_KEY is required when AI_PROVIDER=anthropic/);
  });

  it("rejects unknown providers", () => {
    setEnv({ AI_PROVIDER: "openai" });
    expect(() => aiEnv()).toThrow(/AI_PROVIDER/);
  });
});

describe("createModel", () => {
  it("builds a model for each provider", () => {
    const google = createModel({ provider: "google", model: "gemini-flash-latest", apiKey: "k" });
    const anthropic = createModel({ provider: "anthropic", model: "claude-opus-5-5", apiKey: "k" });
    expect(google.id).toBe("gemini-flash-latest");
    expect(anthropic.id).toBe("claude-opus-5-5");
    expect(typeof google.model).toBe("object");
    expect(typeof anthropic.model).toBe("object");
  });
});
