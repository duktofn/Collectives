import { Sidebar } from "../components/sidebar/Sidebar";
import type { FolderRefIntentInput } from "../features/filesystem/folderRefReadiness";
import type { OperationLeaseRegistry } from "./operationLease";

interface TreeWorkspaceProps {
  onNewCollectionClick: () => void;
  onImportFolderClick: () => void;
  onImportZipClick: () => void;
  onSettingsClick: () => void;
  requestSelect: (entryId: string | null) => Promise<boolean>;
  requestFolderRefSelect: (intent: FolderRefIntentInput) => Promise<boolean>;
  requestSwitch: (collectionId: string) => Promise<boolean>;
  operationLeaseRegistry?: OperationLeaseRegistry;
}

export function TreeWorkspace(props: TreeWorkspaceProps) {
  return <Sidebar {...props} />;
}
