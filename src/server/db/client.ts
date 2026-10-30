import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { appEnv } from "@/config/env";
import * as schema from "./schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

// Reuse one connection pool across Next.js hot reloads in development.
const globalForDb = globalThis as unknown as { proofpayDb?: Db };

export function db(): Db {
  globalForDb.proofpayDb ??= drizzle(postgres(appEnv().DATABASE_URL, { max: 10 }), { schema });
  return globalForDb.proofpayDb;
}

export { schema };
