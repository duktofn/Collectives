import { pickDirectory } from "../../../src/platform/dialogs";
import { editorStore } from "../../../src/stores/editor";

export function InvalidBoundary() {
  void pickDirectory;
  return <button onClick={() => editorStore.selectEntry("synthetic")}>invalid</button>;
}
