import "server-only";

import { z } from "zod";

const emptyToUndefined = (value: unknown) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};

const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const optionalEmail = z.preprocess(
  emptyToUndefined,
  z.string().email().optional(),
);
const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional());
const optionalPort = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int().positive().optional(),
);
const optionalBoolean = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return value;
}, z.boolean().optional());

const rawServerEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  AUTH_URL: optionalUrl,
  APP_URL: optionalUrl,
  AUTH_SECRET: optionalString,
  AUTH_ALLOWED_EMAIL: optionalEmail,
  AUTH_GOOGLE_ID: optionalString,
  AUTH_GOOGLE_SECRET: optionalString,
  DATABASE_URL: optionalString,
  DATABASE_SSL: optionalBoolean.default(false),
  MOLLIE_DEFAULT_MODE: z.enum(["test", "live"]).default("test"),
  MOLLIE_TEST_API_KEY: optionalString,
  MOLLIE_LIVE_API_KEY: optionalString,
  MOLLIE_ORGANIZATION_ID: optionalString,
  MOLLIE_PROFILE_ID: optionalString,
  MOLLIE_WEBHOOK_PUBLIC_BASE_URL: optionalUrl,
  MOLLIE_WEBHOOK_SHARED_SECRET: optionalString,
  SMTP_HOST: optionalString,
  SMTP_PORT: optionalPort.default(587),
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,
  SMTP_FROM: optionalString,
  ALERT_EMAIL_TO: optionalEmail,
});

const parsedServerEnv = rawServerEnvSchema.parse(process.env);

export const env = {
  ...parsedServerEnv,
  AUTH_URL:
    parsedServerEnv.AUTH_URL ?? parsedServerEnv.APP_URL ?? "http://localhost:3000",
  APP_URL:
    parsedServerEnv.APP_URL ?? parsedServerEnv.AUTH_URL ?? "http://localhost:3000",
} as const;

export type MollieMode = "test" | "live";

export type SetupSectionStatus = {
  issues: string[];
  ready: boolean;
};

const postgresUrlSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      value.startsWith("postgres://") || value.startsWith("postgresql://"),
    "DATABASE_URL must be a PostgreSQL connection string.",
  );

const authConfigSchema = z.object({
  AUTH_ALLOWED_EMAIL: z.string().email(),
  AUTH_GOOGLE_ID: z.string().min(1),
  AUTH_GOOGLE_SECRET: z.string().min(1),
  AUTH_SECRET: z.string().min(32),
  AUTH_URL: z.string().url(),
});

const databaseConfigSchema = z.object({
  DATABASE_SSL: z.boolean(),
  DATABASE_URL: postgresUrlSchema,
});

const smtpConfigSchema = z.object({
  ALERT_EMAIL_TO: z.string().email(),
  SMTP_FROM: z.string().min(1),
  SMTP_HOST: z.string().min(1),
  SMTP_PASSWORD: z.string().min(1),
  SMTP_PORT: z.number().int().positive(),
  SMTP_USER: z.string().min(1),
});

const mollieBaseConfigSchema = z.object({
  MOLLIE_DEFAULT_MODE: z.enum(["test", "live"]),
  MOLLIE_ORGANIZATION_ID: z.string().optional(),
  MOLLIE_PROFILE_ID: z.string().optional(),
});

const mollieTestConfigSchema = z.object({
  MOLLIE_TEST_API_KEY: z.string().regex(/^test_/),
});

const mollieLiveConfigSchema = z.object({
  MOLLIE_LIVE_API_KEY: z.string().regex(/^live_/),
});

const mollieWebhookConfigSchema = z.object({
  MOLLIE_WEBHOOK_PUBLIC_BASE_URL: z.string().url(),
  MOLLIE_WEBHOOK_SHARED_SECRET: z.string().min(16),
});

function buildStatus(issues: string[]): SetupSectionStatus {
  return {
    issues,
    ready: issues.length === 0,
  };
}

export function getSetupStatus() {
  const authIssues = [
    env.AUTH_ALLOWED_EMAIL ? null : "AUTH_ALLOWED_EMAIL is missing.",
    env.AUTH_GOOGLE_ID ? null : "AUTH_GOOGLE_ID is missing.",
    env.AUTH_GOOGLE_SECRET ? null : "AUTH_GOOGLE_SECRET is missing.",
    env.AUTH_SECRET ? null : "AUTH_SECRET is missing.",
  ].filter((value): value is string => value !== null);

  const databaseIssues = [
    env.DATABASE_URL ? null : "DATABASE_URL is missing.",
    env.DATABASE_URL &&
    !postgresUrlSchema.safeParse(env.DATABASE_URL).success
      ? "DATABASE_URL is not a PostgreSQL connection string."
      : null,
  ].filter((value): value is string => value !== null);

  const mollieIssues = [
    env.MOLLIE_TEST_API_KEY ? null : "MOLLIE_TEST_API_KEY is missing.",
    env.MOLLIE_LIVE_API_KEY ? null : "MOLLIE_LIVE_API_KEY is missing.",
  ].filter((value): value is string => value !== null);

  const webhookIssues = [
    env.MOLLIE_WEBHOOK_PUBLIC_BASE_URL
      ? null
      : "MOLLIE_WEBHOOK_PUBLIC_BASE_URL is missing.",
    env.MOLLIE_WEBHOOK_SHARED_SECRET
      ? null
      : "MOLLIE_WEBHOOK_SHARED_SECRET is missing.",
  ].filter((value): value is string => value !== null);

  const notificationIssues = [
    env.ALERT_EMAIL_TO ? null : "ALERT_EMAIL_TO is missing.",
    env.SMTP_FROM ? null : "SMTP_FROM is missing.",
    env.SMTP_HOST ? null : "SMTP_HOST is missing.",
    env.SMTP_PASSWORD ? null : "SMTP_PASSWORD is missing.",
    env.SMTP_USER ? null : "SMTP_USER is missing.",
  ].filter((value): value is string => value !== null);

  return {
    auth: buildStatus(authIssues),
    database: buildStatus(databaseIssues),
    mollie: buildStatus(mollieIssues),
    notifications: buildStatus(notificationIssues),
    webhook: buildStatus(webhookIssues),
  };
}

export function getAuthConfig() {
  return authConfigSchema.parse(env);
}

export function getDatabaseConfig() {
  return databaseConfigSchema.parse(env);
}

export function getNotificationConfig() {
  return smtpConfigSchema.parse(env);
}

export function getMollieConfig() {
  return mollieBaseConfigSchema.parse(env);
}

export function getMollieApiKey(mode: MollieMode) {
  if (mode === "test") {
    return mollieTestConfigSchema.parse(env).MOLLIE_TEST_API_KEY;
  }

  return mollieLiveConfigSchema.parse(env).MOLLIE_LIVE_API_KEY;
}

export function getMollieWebhookConfig() {
  return mollieWebhookConfigSchema.parse(env);
}
