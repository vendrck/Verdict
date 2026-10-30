import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { type AiEnv, aiEnv } from "@/config/env";

/**
 * Provider options shared by every structured call. Each provider only reads its own key,
 * so both can be passed regardless of which one is active.
 * - anthropic `outputFormat`: native structured outputs. Current Claude models reject
 *   forced tool use, so the JSON-tool fallback would 400.
 * - `effort` / `thinkingLevel`: verification is judgement-heavy, so ask for deep reasoning.
 */
export const structuredCallOptions = {
  anthropic: { structuredOutputMode: "outputFormat", effort: "high" },
  google: { structuredOutputs: true, thinkingConfig: { thinkingLevel: "high" } },
} as const;

/** For quick fact-gathering tool loops (the dispute investigation): speed over depth. */
export const fastCallOptions = {
  anthropic: { effort: "low" },
  google: { thinkingConfig: { thinkingLevel: "low" } },
} as const;

export interface AiModel {
  provider: AiEnv["provider"];
  /** Model id, recorded on every verdict so results stay attributable. */
  id: string;
  model: LanguageModel;
}

export function createModel(env: AiEnv): AiModel {
  switch (env.provider) {
    case "google":
      return { provider: env.provider, id: env.model, model: createGoogleGenerativeAI({ apiKey: env.apiKey })(env.model) };
    case "anthropic":
      return { provider: env.provider, id: env.model, model: createAnthropic({ apiKey: env.apiKey })(env.model) };
  }
}

let cached: AiModel | undefined;

/** The configured model, chosen by AI_PROVIDER / AI_MODEL. Used for criteria, verification and the copilots. */
export function aiModel(): AiModel {
  cached ??= createModel(aiEnv());
  return cached;
}
