# Work Trace — design decisions

A dated log; later entries can supersede earlier ones. See [`DESIGN.md`](DESIGN.md) for the current design.

1. **Saved-trace inspection first.** Load a local JSON file, render a diagram for after-the-fact review, and export a portable SVG. No live updates or execution control.
2. **Time runs horizontally.** Bars represent observed invocation lifetimes; overlapping bars represent concurrent invocations.
3. **Rows are dynamic.** Reuse lanes after bars finish. Do not reserve a row by agent type, persistent session, or recursion level.
4. **Explicit causal links.** `parentId` identifies the invoking execution. A different edge, `resumesSpanId`, identifies continuity with a prior activation of the same persistent session.
5. **Exclusive persistent sessions.** No two agent spans with the same `sessionId` may overlap. A session may be resumed sequentially, including under a new parent. A running span cannot be followed by another span in the same session.
6. **Compaction is an event.** It annotates a session and optionally an active execution span; it does not imply a restart or a new session.
7. **Versioned JSON is canonical.** Rendering, filtering, and layout do not mutate source data. `schemaVersion: 3` adds Git repository/worktree/ref context; previous session semantics are unchanged.
8. **Review focus, not live animation.** Lanes can be recomputed after a file import or visibility change. Saved incomplete snapshots may still include a `running` span.

9. **Worktrees, not branches, are workspace identities.** Branch/HEAD checkout is timestamp-dependent worktree metadata and may change while an agent executes. One repo may have many worktrees.
10. **Workspace belongs to invocation, not persistent session.** `spans[].worktreeId` is optional and explicit; resume may use a different worktree. No auto-inheritance from parent or previous activation. v3 records one primary worktree per span.
11. *(Superseded by 18.)* **Two complementary views.** Default Execution view uses global dynamic lanes and worktree accents/highlighting. Workspace view uses variable-height grouping boxes, each with dynamic reusable lanes. Causal and resume links may cross group boundaries.
12. **Ref intervals convey branch switches.** `worktreeRefs[]` are non-overlapping intervals; gaps mean unknown branch/HEAD, not implicit inheritance.

13. **Library-first, single repository.** Use Svelte 5 + TypeScript with the SvelteKit library scaffold: `src/lib` is reusable package code; `src/routes` is a small development/demo consumer. No monorepo or separate demo repository.
14. **Framework boundary.** Trace model, JSON Schema validation, and deterministic layout are pure TypeScript; SVG rendering, selection, and viewport interaction are Svelte components. Export only a small public API from `src/lib/index.ts`.
15. **Git delivery without registry publishing.** Consume version-pinned Git references using pnpm. `@sveltejs/package` builds the distributable library. Verify Git-install lifecycle/prepare permissions in a separate host-project smoke test.
16. **Nix for tools, pnpm for dependencies.** Use a minimal Nix flake dev shell and commit both Nix and pnpm lockfiles. No dedicated Nix library packaging/output for MVP.
17. **Embedding scope.** Interactive use is via a Svelte component in Svelte apps. Non-Svelte pages may embed exported standalone SVG. Interactive Web Components/JS mount APIs are deferred.

## 2026-10-15 — Workspace view replaced by a worktree overlay

18. **One layout, worktrees as an overlay.** The separate Workspace view (and the `view` prop, `ExportOptions.view`, `TimelineView`) is removed; decision 11's "two complementary views" is superseded. There is a single execution layout. Worktrees are drawn as an optional overlay (`showWorktrees`, default on; same option in `ExportOptions`): each region is a light tinted rounded rectangle behind the bars with a label chip on its top border (worktree label plus the ref at region start). Hovering or clicking a region or chip highlights that worktree and dims the rest.
19. **The base worktree is not boxed.** The worktree of the earliest root span is the backdrop of the run. It is noted once (legend / export header, e.g. `base: Main checkout · main`) and only the other worktrees get boxes.
20. **Subtree packing keeps each worktree switch a clean rectangle.** Layout packs each visible subtree as a block; a subtree whose worktree differs from its visual parent's is placed as a solid rows × time rectangle that nothing else may enter. So a box never encloses unrelated bars (which was the objection to global boxes in decision 11), regions can nest, and unknown worktrees (no `worktreeId`) get no box. The per-bar worktree stripe and badge are gone; ref-switch ticks on bars remain.


## 2026-10-16 — Scale and zoom

21. **Zooming out past Fit compacts rows (density), it does not shrink time further.** Below Fit there is no more time to show, so further zoom-out lowers a view-only density (0.15–1) that scales bar height and row pitch. Detail drops in steps: worktree chips below 0.85, labels and pause pills below 0.7. Zooming in restores density before zooming time. **Overview** fits time and the largest density at which all rows fit the visible height. Density never re-runs layout.
22. **Live text fitting uses real font metrics; export uses the estimate table.** On screen, label fit and ellipsis use canvas `measureText` with the same font stack as the SVG (cached). Exports keep the deterministic width table, so an export is identical on any machine. A clipped label must keep about 6 characters; otherwise it is omitted rather than shown as a fragment.
23. **Dense call regions are drawn as clusters.** Three or more bars in one row, each under 6px and at most 4px apart, become one strip with a summary tooltip; clicking it zooms to its range. Selected and highlighted bars are never clustered. Together with culling of off-screen rows and per-frame wheel coalescing, this keeps a 7.7k-span trace interactive. A canvas renderer is deferred until deep-zoom DOM cost (≈150–250 ms per step at 1–2k visible bars) is a real problem.
24. **Layout invariants are checked by a script, not a test framework.** `pnpm check:layout` (run by `pnpm check`) asserts the layout guarantees on the sample and 2,000 fuzzed traces with worktree switches and resumes. It is the only automated check besides svelte-check and the build.

## 2026-10-16 — Renamed to Work Trace

25. **Agent Timeline is renamed Work Trace.** The library visualizes how work unfolds over time (hierarchy, parallelism, delegation, pauses, resumes, handoffs), and future traces may include human tasks and automated steps, so the name no longer ties it to agents. Package `work-trace`; component `WorkTimeline` (was `AgentTimeline`) with `WorkTimelineProps`; types `WorkTrace` (was `AgentTimelineTrace`), `WorkSpan` (was `ExecutionSpan`), `WorkEvent` (was `SessionEvent`); schema file `work-trace.schema.json`. This is a naming change only: the JSON structure (`schemaVersion: 3`, `agentSessions`, `kind: "agent"`, compaction events, worktrees) and all behavior are unchanged, and existing traces load as before. Agent-specific types (`AgentSession`, `AgentSpan`, `CallSpan`, `CompactionEvent`) keep their names. No compatibility aliases: the only consumer is the demo in this repo.
