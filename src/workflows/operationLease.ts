export interface OperationLease {
  token: string;
  label: string;
  release(): void;
}

export interface OperationLeaseRegistry {
  register(label: string): OperationLease;
  activeCount(): number;
  activeLabels(): string[];
  waitForIdle(): Promise<void>;
}

export function createOperationLeaseRegistry(): OperationLeaseRegistry {
  const active = new Map<string, string>();
  const waiters = new Set<() => void>();
  let nextToken = 0;

  const notifyIdle = () => {
    if (active.size !== 0) return;
    for (const resolve of waiters) resolve();
    waiters.clear();
  };

  return {
    register(label) {
      const token = `workflow-lease-${++nextToken}`;
      active.set(token, label);
      let released = false;
      return {
        token,
        label,
        release() {
          if (released) return;
          released = true;
          active.delete(token);
          notifyIdle();
        },
      };
    },
    activeCount: () => active.size,
    activeLabels: () => [...active.values()],
    waitForIdle() {
      if (active.size === 0) return Promise.resolve();
      return new Promise<void>((resolve) => waiters.add(resolve));
    },
  };
}
