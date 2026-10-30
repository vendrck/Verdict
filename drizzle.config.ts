import { defineConfig } from "drizzle-kit";

// drizzle-kit doesn't read .env itself. In CI/production DATABASE_URL comes from the real environment.
try {
  process.loadEnvFile(".env");
} catch {
  // no .env file: fine
}

export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./src/server/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
