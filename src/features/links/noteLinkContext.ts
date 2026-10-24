import { Facet } from "@codemirror/state";
import type { NoteLinkContext } from "./noteLinkServices";

export * from "./noteLinkServices";

export const noteLinkContextFacet = Facet.define<NoteLinkContext, NoteLinkContext | null>({
  combine(values) {
    return values.length ? values[values.length - 1] : null;
  },
});
