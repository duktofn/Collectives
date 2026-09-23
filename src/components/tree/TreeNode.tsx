import { Entry } from "../../types";
import { FileNode } from "./FileNode";
import { FolderRefNode } from "./FolderRefNode";
import { GroupNode } from "./GroupNode";

interface TreeNodeProps {
  entry: Entry;
  depth: number;
  parentPath: number[];
  index: number;
  parentTreeId?: string;
  requestSelect: (entryId: string | null) => Promise<boolean>;
  requestFolderRefSelect: (intent: import("../../features/filesystem/folderRefReadiness").FolderRefIntentInput) => Promise<boolean>;
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
          parentTreeId={props.parentTreeId}
          requestSelect={props.requestSelect}
        />
      )}
      {props.entry.type === "folder-ref" && (
        <FolderRefNode
          entry={props.entry}
          depth={props.depth}
          parentPath={props.parentPath}
          index={props.index}
          parentTreeId={props.parentTreeId}
          requestFolderRefSelect={props.requestFolderRefSelect}
        />
      )}
      {props.entry.type === "group" && (
        <GroupNode
          entry={props.entry}
          depth={props.depth}
          parentPath={props.parentPath}
          index={props.index}
          parentTreeId={props.parentTreeId}
          requestSelect={props.requestSelect}
          requestFolderRefSelect={props.requestFolderRefSelect}
        />
      )}
    </>
  );
}
