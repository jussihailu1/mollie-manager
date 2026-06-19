export const CUSTOMER_NOTE_MAX_LENGTH = 2000;

export function normalizeCustomerNoteBody(value: string) {
  const body = value.trim();

  if (!body) {
    return null;
  }

  return body.slice(0, CUSTOMER_NOTE_MAX_LENGTH);
}
