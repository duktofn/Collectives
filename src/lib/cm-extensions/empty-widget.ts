import { WidgetType } from "@codemirror/view";

export class EmptyWidget extends WidgetType {
  eq(_other: EmptyWidget) {
    return true;
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-hidden-mark";
    span.style.display = "none";
    return span;
  }
}
