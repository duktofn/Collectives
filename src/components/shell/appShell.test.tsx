import { render } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { ActivityStatus } from "./ActivityStatus";
import { AppShell } from "./AppShell";
import { WorkspaceHeader } from "./WorkspaceHeader";

describe("AppShell presentation boundaries", () => {
  it("renders one labelled navigation, one main and the four named slots", () => {
    const { container } = render(() => (
      <AppShell
        sidebar={<aside aria-label="Collection navigation">Navigation</aside>}
        workspaceHeader={<WorkspaceHeader isEditorOpen={false} />}
        activityStatus={<ActivityStatus label="Ready" />}
        workspaceBody={<section>Body</section>}
      />
    ));

    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(container.querySelectorAll("aside[aria-label='Collection navigation']")).toHaveLength(1);
    expect(container.querySelectorAll("[data-shell-slot='sidebar']")).toHaveLength(1);
    expect(container.querySelectorAll("[data-shell-slot='workspaceHeader']")).toHaveLength(1);
    expect(container.querySelectorAll("[data-shell-slot='activityStatus']")).toHaveLength(1);
    expect(container.querySelectorAll("[data-shell-slot='workspaceBody']")).toHaveLength(1);
    expect(container.querySelectorAll("[role='status']")).toHaveLength(1);
    expect(container.querySelectorAll("[role='dialog']")).toHaveLength(0);
  });

  it("exposes exactly one labelled expand control when the sidebar is collapsed", () => {
    const { container } = render(() => (
      <AppShell
        sidebar={<aside aria-label="Collection navigation" />}
        workspaceHeader={<WorkspaceHeader isEditorOpen={false} />}
        activityStatus={<ActivityStatus label="Ready" />}
        workspaceBody={<section>Body</section>}
        sidebarCollapsed
        onExpandSidebar={() => undefined}
      />
    ));
    expect(container.querySelectorAll("button[aria-label='Expand sidebar']")).toHaveLength(1);
    expect(container.querySelector("button[aria-label='Expand sidebar']")?.closest("header")).not.toBeNull();
  });
});
