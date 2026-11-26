const readArchive = async (path: string) => {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(
      `Couldn't load ${path} (HTTP ${response.status}). Run bun run link at the repo root.`,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
};

export async function readMinecraftArchives() {
  const [jar, picked] = await Promise.all([
    readArchive("mc/client_assets.zip"),
    readArchive("picked.zip"),
  ]);
  return { jar, picked };
}
