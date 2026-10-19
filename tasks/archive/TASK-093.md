## TASK-093 — Keep added folders as folder references

**State:** Cancelled
**Cancellation reason:** User withdrew folder-as-group request.
**Current Step:** Cancelled before implementation

### Description
Implement the user's 2026-10-19 priority fix before TASK-016–020, Windows scope only.

### Scope
src/stores/collections.ts; collection adapters; related task/changelog records.

### Requirements
- [ ] Resolve the reported behavior while retaining existing intended interactions.

### Steps
- [ ] Inspect current implementation and supplied screenshots where applicable → verify: identify cause.
- [ ] Apply focused change → verify: source review and relevant static checks.
- [ ] Commit separately with task ID → verify: record commit in task.md.

### Handoff
- Branch: main; base: b43e4cd.
- Next action: inspect scope and implement this request in priority order.
- Blockers: none.

### Verification
Not verified. No tests requested for this batch.

### Log
- 2026-10-19 — Created from direct implementation request; authorized before the next five plan tasks (016–020).

- 2026-10-19 — User confirmed the intent was a group containing files, then withdrew it. No folder behavior changed.
