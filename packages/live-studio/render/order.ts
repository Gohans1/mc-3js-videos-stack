import { checkOrder, orderTimes } from "../checks/order.mjs";
import { canvas, post, still } from "./lab";

type Draw = ((t: number) => void | Promise<void>) & {
  renderFrame?: (t: number) => void | Promise<void>;
};

export const orderCheck =
  (render: Draw, duration: number, cuts: number[]) =>
  async (_target = "", from = 0, to = duration) => {
    const source = canvas() as HTMLCanvasElement;
    const copy = document.createElement("canvas");
    copy.width = source.width;
    copy.height = source.height;
    const ctx = copy.getContext("2d", { willReadFrequently: true })!;
    const result = await checkOrder(
      async (t: number) => {
        if (render.renderFrame) await render.renderFrame(t);
        else await render(t);
        ctx.globalCompositeOperation = "copy";
        ctx.drawImage(source, 0, 0);
        return ctx.getImageData(0, 0, copy.width, copy.height);
      },
      orderTimes(duration, cuts, from, to),
    );
    const evidence: string[] = [];
    if (result.evidence) {
      for (const key of ["before", "after"] as const) {
        const image = result.evidence[key];
        const picture = document.createElement("canvas");
        picture.width = image.width;
        picture.height = image.height;
        picture
          .getContext("2d")!
          .putImageData(
            new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
            0,
            0,
          );
        const name = `order_${result.evidence.at}_${key}.png`;
        await still(name, picture);
        evidence.push(`renders/${name}`);
      }
    }
    await post(
      "/still/order.json",
      JSON.stringify(
        {
          clock: "heard seconds",
          tolerance: 2,
          blockSize: 8,
          times: result.times,
          failures: result.failures,
          evidence,
        },
        null,
        2,
      ),
    );
    if (result.failures.length)
      return [
        `ERROR order: ${result.failures.length}/${result.times.length} sampled frames depend on draw order; compare ${evidence.join(" and ")}. Reset accumulated state or evaluate it from t (renders/order.json)`,
      ];
    return [
      `order: ${result.times.length} frames drawn in two shuffled orders: same picture within 2/255 per 8x8 block (renders/order.json; sampled diagnostic, not a proof for every frame)`,
    ];
  };
