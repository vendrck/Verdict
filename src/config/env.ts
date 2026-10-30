import { z } from "zod";

/**
 * Environment is validated per area, lazily, so a script that only talks to
 * PayPal doesn't fail because ANTHROPIC_API_KEY is missing (and vice versa).
 */

const paypalSchema = z.object({
  PAYPAL_ENV: z.enum(["sandbox", "live"]).default("sandbox"),
  PAYPAL_CLIENT_ID: z.string().min(1, "PAYPAL_CLIENT_ID is required"),
  PAYPAL_CLIENT_SECRET: z.string().min(1, "PAYPAL_CLIENT_SECRET is required"),
  PAYPAL_WEBHOOK_ID: z.string().optional(),
});

export const AI_PROVIDERS = ["google", "anthropic"] as const;

/** Model used when AI_MODEL is not set. */
export const DEFAULT_MODELS = {
  google: "gemini-flash-latest",
  anthropic: "claude-opus-5-5",
} as const satisfies Record<(typeof AI_PROVIDERS)[number], string>;

const API_KEY_VAR = {
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
} as const;

const aiSchema = z
  .object({
    // An empty `AI_PROVIDER=` line in .env means "use the default", not "invalid".
    AI_PROVIDER: z.preprocess((v) => (v === "" ? undefined : v), z.enum(AI_PROVIDERS).default("google")),
    AI_MODEL: z.string().optional(),
    GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    const keyVar = API_KEY_VAR[env.AI_PROVIDER];
    if (!env[keyVar]) {
      ctx.addIssue({ code: "custom", path: [keyVar], message: `${keyVar} is required when AI_PROVIDER=${env.AI_PROVIDER}` });
    }
  })
  .transform((env) => ({
    provider: env.AI_PROVIDER,
    model: env.AI_MODEL || DEFAULT_MODELS[env.AI_PROVIDER],
    apiKey: env[API_KEY_VAR[env.AI_PROVIDER]] as string,
  }));

const appSchema = z.object({
  // On Render, default to the service's public URL (PayPal redirects back to it).
  APP_BASE_URL: z.preprocess(
    (v) => v || process.env.RENDER_EXTERNAL_URL || undefined,
    z.url().default("http://localhost:3000"),
  ),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  GITHUB_TOKEN: z.string().optional(),
  /** Unlocks /admin. Unset = admin disabled. Long, because admins move money. */
  ADMIN_PASSWORD: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().min(12, "ADMIN_PASSWORD must be at least 12 characters").optional(),
  ),
});

export type PayPalEnv = z.infer<typeof paypalSchema>;
export type AiEnv = z.infer<typeof aiSchema>;
export type AppEnv = z.infer<typeof appSchema>;

function parse<T extends z.ZodType>(schema: T, area: string): z.infer<T> {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid ${area} environment:\n${issues}`);
  }
  return result.data;
}

export const paypalEnv = (): PayPalEnv => parse(paypalSchema, "PayPal");
export const aiEnv = (): AiEnv => parse(aiSchema, "AI");
export const appEnv = (): AppEnv => parse(appSchema, "app");
