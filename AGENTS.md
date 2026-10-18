# Task tracking

- Before making any user-requested change to the repository codebase, create a task or update the existing task that owns that scope. This applies to every change, including the smallest edit, one-line fixes, and changes to source code, tests, configuration, scripts, assets, or repository documentation.
- Do not skip task tracking because a change is quick, trivial, or reversible. This rule overrides the quick-edit exceptions in the task-logging skill.
- Git commits, staging, pushing, and similar repository bookkeeping do not need separate tasks. Questions and read-only inspection also do not need tasks.
- A direct implementation request authorizes starting its task; task creation does not add an approval step. Keep proposals Pending when the user asks to review them before implementation.

- Commit each task as a focused commit referencing its task ID after completing its required checks, and commit completed work before starting the next task. Record the commit hash in task.md. If a task pauses with coherent verified changes, commit those changes and record the remaining verification honestly; do not mark it Done before its acceptance criteria pass. Keep unrelated tasks and changes out of that commit.

# Changelog and release conventions

- Write all changelog entries in English.
- Maintain `CHANGELOG.md` with these fields and sections for each version, in this order: **Version**, **Release date**, **Major changes**, **Feature changes**, and **Bug fixes**.
- Use `## [Unreleased]`, `**Version:** Unreleased`, and `**Release date:** TBD` for changes not yet assigned to a release. Add new changes there unless the user names a target version.
- Use `## [x.y.z]`, `**Version:** x.y.z`, and `**Release date:** YYYY-MM-DD` for a release. Keep the three change sections even if a section has no entries.
- Record only implemented changes and fixed bugs. Describe user-visible behavior rather than internal work history.
- Build releases with `npm run release:build`. It writes that version's changelog to `release/x.y.z/changelog.md`; do not include the Unreleased section or other versions in that file.
