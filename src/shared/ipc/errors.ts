export interface SafetyError {
  code: string;
  message: string;
  details?: unknown;
}

export interface LegacyInvokeError {
  kind: "legacy-invoke-error";
  cause: unknown;
}

export type IpcError = SafetyError | LegacyInvokeError | string | unknown;

export function asSafetyError(error: unknown): SafetyError | null {
  if (
    error
    && typeof error === "object"
    && typeof (error as SafetyError).code === "string"
    && typeof (error as SafetyError).message === "string"
  ) {
    return error as SafetyError;
  }
  return null;
}

export function asLegacyInvokeError(error: unknown): LegacyInvokeError {
  return { kind: "legacy-invoke-error", cause: error };
}

export function formatIpcError(error: unknown): string {
  const safety = asSafetyError(error);
  if (safety) return `${safety.code}: ${safety.message}`;
  return error instanceof Error ? error.message : String(error) || "IPC operation failed";
}
