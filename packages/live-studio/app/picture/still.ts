import { S } from "../core/state";
import { say } from "../core/store";
import { stamp } from "../core/time";
import { setPlaying } from "../playback/transport";

type Format = "image/png" | "image/jpeg";
// Chrome's File System Access save dialog, which TypeScript's DOM types leave out (not in every browser)
declare global {
  interface Window {
    showSaveFilePicker?: (o: {
      id?: string;
      startIn?: string;
      suggestedName?: string;
      types?: { description: string; accept: Record<string, string[]> }[];
    }) => Promise<FileSystemFileHandle>;
  }
}

type Place = { format: Format; save: (b: Blob) => Promise<void> };
const download = (name: string): Place => ({
  format: "image/png",
  save: async (b) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = `${name}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  },
});
const pickPlace = async (name: string): Promise<Place | null> => {
  if (!window.showSaveFilePicker) return download(name);
  try {
    const file = await window.showSaveFilePicker({
      id: "still-frame",
      startIn: "pictures",
      suggestedName: `${name}.png`,
      types: [
        { description: "PNG image", accept: { "image/png": [".png"] } },
        { description: "JPEG image", accept: { "image/jpeg": [".jpg", ".jpeg"] } },
      ],
    });
    return {
      format: /\.jpe?g$/i.test(file.name) ? "image/jpeg" : "image/png",
      save: async (b) => {
        const w = await file.createWritable();
        await w.write(b);
        await w.close();
      },
    };
  } catch (e) {
    return (e as DOMException).name === "AbortError" ? null : download(name);
  }
};

export const exportStill = async () => {
  if (S.playing) setPlaying(false);
  const t = S.t,
    place = await pickPlace(`${S.film}_${stamp(t).replace(":", "-")}`);
  if (!place) return;
  const { buildFinal, captureFinalFrame } = await import("./render");
  await buildFinal();
  if (S.t !== t) {
    say("The playhead moved before the frame was drawn: export it again");
    return;
  }
  const c = document.createElement("canvas");
  await captureFinalFrame(t, (from) => {
    c.width = from.width;
    c.height = from.height;
    c.getContext("2d")!.drawImage(from, 0, 0);
  });
  const blob = await new Promise<Blob | null>((done) => c.toBlob(done, place.format, 0.95));
  if (!blob) {
    say("Couldn't export the still frame: the browser couldn't encode it");
    return;
  }
  try {
    await place.save(blob);
  } catch {
    say("Couldn't export the still frame: the file couldn't be written");
    return;
  }
  say(`Still frame exported (${c.width}×${c.height}, ${stamp(t)})`);
};
