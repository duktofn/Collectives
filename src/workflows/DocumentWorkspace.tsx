import { Show } from "solid-js";
import { Editor } from "../components/editor/Editor";

export function DocumentWorkspace(props: { isOpen: boolean }) {
  return <Show when={props.isOpen}><Editor /></Show>;
}
