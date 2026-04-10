import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

loadEnvConfig(process.cwd());

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for Drizzle commands.");
}

export default defineConfig({
  dbCredentials: {
    ssl: process.env.DATABASE_SSL === "true",
    url: process.env.DATABASE_URL,
  },
  dialect: "postgresql",
  out: "./db/drizzle",
  schema: "./db/schema.ts",
  strict: true,
  verbose: true,
});
