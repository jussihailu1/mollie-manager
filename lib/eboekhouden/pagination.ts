// The API's count is the number of retrieved items, not a total-row count.
// Never use it to stop a full-page scan early.
export async function readAllEboekhoudenPages<T extends { id: number }>(
  readPage: (limit: number, offset: number) => Promise<{ items?: T[]; count?: number }>,
  pageSize = 500,
  maxPages = 20,
): Promise<T[]> {
  const result: T[] = [];
  const ids = new Set<number>();
  for (let page = 0; page < maxPages; page++) {
    const response = await readPage(pageSize, page * pageSize);
    if (!Array.isArray(response.items)) throw new Error("e-Boekhouden returned no item list; refusing an incomplete scan.");
    for (const item of response.items) {
      if (!Number.isSafeInteger(item.id) || item.id <= 0 || ids.has(item.id)) {
        throw new Error("e-Boekhouden pagination returned an invalid/repeated ID; manual review required.");
      }
      ids.add(item.id);
      result.push(item);
    }
    if (response.items.length < pageSize) return result;
  }
  throw new Error("e-Boekhouden scan limit reached; manual review required before any write.");
}
