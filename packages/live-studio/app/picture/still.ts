import { S } from "../core/state";
import { say } from "../core/store";
// CapCut's Export still frame (its Player menu): the frame on screen at final quality, the free camera's view included and the
// studio's overlays left out, saved as a picture for a thumbnail. As in CapCut the dev picks the name, the folder and PNG or JPEG,
// here in the browser's own Save dialog; a browser without one (Firefox, Safari) downloads a PNG
import { stamp } from "../core/time";
import { setPlaying } from "../playback/transport";
import { buildFinal, drawFinalFrame } from "./render";

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
// Where the picture goes, asked before anything is drawn: the dialog needs the click that opened it, and building the final
// renderer the first time takes longer than the click counts for. null: the dialog was closed
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
    return (e as DOMException).name === "AbortError" ? null : download(name); // refused (no click to go on, a policy): a download
  }
};

export const exportStill = async () => {
  if (S.playing) setPlaying(false);
  const t = S.t,
    place = await pickPlace(`${S.film}_${stamp(t).replace(":", "-")}`);
  if (!place) return;
  await buildFinal();
  if (S.t !== t) {
    say("The playhead moved before the frame was drawn: export it again");
    return;
  } // a scrub during the first build
  drawFinalFrame();
  // Copied out at once: a WebGL canvas may be cleared once the page is next shown
  const c = document.createElement("canvas");
  c.width = S.el.final.width;
  c.height = S.el.final.height;
  c.getContext("2d")!.drawImage(S.el.final, 0, 0);
  S.finalAt = -1;
  S.dirty = true;
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
