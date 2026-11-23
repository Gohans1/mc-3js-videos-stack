import { FONTS, preloadTitleFonts } from "../../src/titles";

Object.assign(window, {
  async preparedTitleFonts() {
    const font = FONTS.find((f) => f.id === "serif")!;
    const checks = () =>
      [400, 700].map((w) => document.fonts.check(`${w} 40px ${font.css}`, "AÀaà0"));
    const before = checks();
    await preloadTitleFonts([{ font: "serif" }]);
    return {
      before,
      after: checks(),
      defined: [...document.fonts].some((f) => f.family.includes("Source Serif")),
    };
  },
  async missingFonts() {
    const missing: string[] = [];
    for (const f of FONTS)
      for (const w of [400, 700])
        if (!(await document.fonts.load(`${w} 40px ${f.css}`, "AÀaà0")).length)
          missing.push(`${f.id} ${w}`);
    return missing;
  },
});
