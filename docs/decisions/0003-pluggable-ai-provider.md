# ADR 0003: Pluggable AI provider (Gemini or Claude)

- **Status:** accepted (2026-10-30)

## Context
The hackathon provides no AI credits. Claude is billed per token. Google AI Studio offers a free Gemini API tier with rate limits. Paid consumer plans (Gemini Plus/Pro, Claude Pro) do not include API access. We want to build at no cost, but still be able to compare models and pick the better one for the demo.

## Decision
All AI code takes an AI SDK `LanguageModel`. Only `src/server/ai/model.ts` knows about providers. Configuration:

| Variable | Values | Default |
|---|---|---|
| `AI_PROVIDER` | `google`, `anthropic` | `google` |
| `AI_MODEL` | any model id of that provider | `gemini-flash-latest` / `claude-opus-5-5` |
| `GOOGLE_GENERATIVE_AI_API_KEY` | required when `AI_PROVIDER=google` | |
| `ANTHROPIC_API_KEY` | required when `AI_PROVIDER=anthropic` | |

Structured output uses each provider's native JSON-schema mode. Claude's forced-tool fallback is disabled because current Claude models reject forced tool use.

## Consequences
- Switching providers is an env change. The verifier's guard rails (CI decided in code, overall verdict computed in code, confidence floor) apply to both.
- The model id is stored on every verdict, so results stay attributable.
- Gemini's free tier may use prompts and responses to improve Google's products. For real client code, use a paid tier or Claude.
- Free-tier rate limits are low. Run AI evals sparingly, or switch to a paid key for bulk testing.
