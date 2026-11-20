export const isMcPackFilename = (name: unknown): name is string =>
  typeof name === "string" &&
  !name.includes("..") &&
  !/[\\/:]/.test(name) &&
  /\.(jar|zip)$/i.test(name);

export function validatePickManifest(rows: unknown) {
  if (!Array.isArray(rows)) throw new Error("pack/picks.json must be a JSON array");
  const hasText = (value: unknown) => typeof value === "string" && value.length > 0;
  const validIds = (ids: unknown) =>
    ids === undefined || (Array.isArray(ids) && ids.every(hasText));
  for (const [index, row] of rows.entries()) {
    if (!isMcPackFilename(row?.jar))
      throw new Error(
        `pack/picks.json entry ${index + 1}: expected a .jar or .zip filename in vault/packs`,
      );
    if (
      !hasText(row.namespace) ||
      !validIds(row.blocks) ||
      !validIds(row.items) ||
      !(row.blocks?.length || row.items?.length)
    )
      throw new Error(
        `pack/picks.json entry ${index + 1}: expected a namespace and at least one block or item ID`,
      );
  }
  return rows;
}
