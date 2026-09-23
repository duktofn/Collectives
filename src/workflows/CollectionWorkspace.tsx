import { JSX } from "solid-js";

export function CollectionWorkspace(props: { children: JSX.Element }) {
  return <div class="collection-workspace" data-workflow-owner="collection-workspace">{props.children}</div>;
}
