/* @refresh reload */
import { render } from "solid-js/web";
import App from "./App";
const fixtureEnabled = import.meta.env.VITE_PHASE4_VISUAL_FIXTURE === "1";
const phase5FixtureEnabled = import.meta.env.VITE_PHASE5_WORKFLOW_FIXTURE === "1";
if (phase5FixtureEnabled) {
  void import("./visual-fixtures/phase5WorkflowFixture").then(({ Phase5WorkflowFixture }) => render(() => <Phase5WorkflowFixture />, document.getElementById("root") as HTMLElement));
} else if (fixtureEnabled) {
  void import("./visual-fixtures/phase4ShellFixture").then(({ Phase4ShellFixture }) => render(() => <Phase4ShellFixture />, document.getElementById("root") as HTMLElement));
} else {
  render(() => <App />, document.getElementById("root") as HTMLElement);
}
