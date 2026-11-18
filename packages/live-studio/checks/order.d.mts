export interface FrameImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
export interface OrderResult {
  times: number[];
  failures: { at: number; difference: number }[];
  evidence?: { at: number; before: FrameImage; after: FrameImage };
}
export function orderTimes(duration: number, cuts?: number[], from?: number, to?: number): number[];
export function checkOrder(
  capture: (t: number) => FrameImage | Promise<FrameImage>,
  times: number[],
  tolerance?: number,
): Promise<OrderResult>;
