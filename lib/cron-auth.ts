export function getAcceptedCronSecrets(input: {
  cronSecret?: string | null;
  invoiceCronSharedSecret?: string | null;
}) {
  const secrets = [input.invoiceCronSharedSecret, input.cronSecret]
    .filter((value): value is string => Boolean(value && value.length > 0));

  return Array.from(new Set(secrets));
}

export function isBearerAuthorized(
  authorizationHeader: string | null,
  secrets: string[],
) {
  if (!authorizationHeader || secrets.length === 0) {
    return false;
  }

  return secrets.some((secret) => authorizationHeader === `Bearer ${secret}`);
}
