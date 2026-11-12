import { createCn } from "cn/config";

// cn() as shadcn's, told the theme's own steps (index.css @theme), so text-ui merges as a size beside a text colour
export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [{ text: ["tag", "ui", "title"] }],
      shadow: [{ shadow: ["float", "sheet"] }],
    },
  },
});
