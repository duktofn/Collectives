import { Entry } from "../../types";
import { FileNode } from "./FileNode";
import { FolderRefNode } from "./FolderRefNode";
import { GroupNode } from "./GroupNode";

interface TreeNodeProps {
  entry: Entry;
  depth: number;
  parentPath: number[];
  index: number;
}

export function TreeNode(props: TreeNodeProps) {
  return (
    <>
      {props.entry.type === "file" && (
        <FileNode
          entry={props.entry}
          depth={props.depth}
          parentPath={props.parentPath}
          index={props.index}
        />
      )}
      {props.entry.type === "folder-ref" && (
        <FolderRefNode
          entry={props.entry}
          depth={props.depth}
          parentPath={props.parentPath}
          index={props.index}
        />
      )}
      {props.entry.type === "group" && (
        <GroupNode
          entry={props.entry}
          depth={props.depth}
          parentPath={props.parentPath}
          index={props.index}
        />
      )}
    </>
  );
}
