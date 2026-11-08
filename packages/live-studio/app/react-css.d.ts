// A style prop sets CSS custom properties only (the shadcn lint's no-inline-styles), read by a class such as h-(--row-h).
// React adds no "px" to a number given to a custom property: a length goes in as a string ("50px"), a bare number stays unitless
import "react";

declare module "react" {
  interface CSSProperties {
    [name: `--${string}`]: string | number | undefined;
  }
}
