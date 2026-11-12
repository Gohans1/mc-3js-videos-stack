// The title fonts as a film loads them (titles.ts imports their CSS); test/fonts.test.ts calls window.missingFonts() for the
// FONTS whose family has no face the browser can load at a weight titles draw in.
import { FONTS } from "../../src/titles";

Object.assign(window, {
  async missingFonts() {
    const missing: string[] = [];
    for (const f of FONTS)
      for (const w of [400, 700])
        if (!(await document.fonts.load(`${w} 40px ${f.css}`, "AÀaà0")).length)
          missing.push(`${f.id} ${w}`);
    return missing;
  },
});
