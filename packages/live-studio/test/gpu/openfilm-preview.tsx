import { createRoot } from "react-dom/client";

import { OpenFilmPreview } from "../../app/openfilm/Preview";

Object.assign(window, {
  async previewDuration() {
    const recipes = await (await fetch("/_openfilm/catalog")).json();
    const root = createRoot(document.body);
    root.render(
      <OpenFilmPreview
        recipe={recipes.find((r: { id: string }) => r.id === "motions/in-fade")}
        props={{}}
      />,
    );
    try {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const animation = document.querySelector("iframe")?.contentDocument?.getAnimations()[0];
        if (animation) return animation.effect!.getTiming().duration;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error("Preview did not create its animation within 5 s");
    } finally {
      root.unmount();
    }
  },
});
