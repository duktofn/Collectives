import { createSignal } from "solid-js";
import { Dialog } from "../components/common/Dialog";
import { ZipConflictDialog } from "../components/common/ZipConflictDialog";
import type { ZipConflict, ZipResolution } from "../types";
import type { OperationLeaseRegistry } from "./operationLease";

export async function runArchiveOperation<T>(leaseRegistry: OperationLeaseRegistry, label: string, operation: () => Promise<T>): Promise<T> {
  const lease = leaseRegistry.register(label);
  try {
    return await operation();
  } finally {
    lease.release();
  }
}

interface ArchiveWorkflowProps {
  leaseRegistry: OperationLeaseRegistry;
  importFolderPath: string;
  importFolderNameOpen: boolean;
  importFolderNameError: string;
  onImportFolderConfirm: (name?: string) => Promise<void>;
  onImportFolderClose: () => void;
  zipFilePath: string;
  zipDestFolder: string;
  zipConflicts: ZipConflict[];
  zipConflictOpen: boolean;
  onZipConfirm: (resolutions: Record<string, ZipResolution>) => Promise<void>;
  onZipClose: () => void;
}

export function ArchiveWorkflow(props: ArchiveWorkflowProps) {
  const [folderPending, setFolderPending] = createSignal(false);
  const [zipPending, setZipPending] = createSignal(false);
  const runFolder = async (name?: string) => {
    setFolderPending(true);
    try { await runArchiveOperation(props.leaseRegistry, "Import folder", () => props.onImportFolderConfirm(name)); }
    finally { setFolderPending(false); }
  };
  const runZip = async (resolutions: Record<string, ZipResolution>) => {
    setZipPending(true);
    try { await runArchiveOperation(props.leaseRegistry, "Import ZIP", () => props.onZipConfirm(resolutions)); }
    finally { setZipPending(false); }
  };
  return (
    <>
      <Dialog
        isOpen={props.importFolderNameOpen}
        title="Import Folder: Choose Collection Name"
        type="input"
        defaultValue={props.importFolderPath.replace(/\\/g, "/").split("/").pop() || "Imported Vault"}
        placeholder="Collection name"
        errorMessage={props.importFolderNameError}
        pending={folderPending()}
        onConfirm={runFolder}
        onClose={props.onImportFolderClose}
      />
      <ZipConflictDialog
        isOpen={props.zipConflictOpen}
        conflicts={props.zipConflicts}
        pending={zipPending()}
        onConfirm={runZip}
        onClose={props.onZipClose}
      />
    </>
  );
}
