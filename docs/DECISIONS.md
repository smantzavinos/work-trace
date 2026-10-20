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

## 2026-10-20 — Work items and handoffs

26. **Work grouping is explicit, optional data.** A plan → review → fixes stream was hard to follow: its spans are siblings of different sessions and agent types, so parentage and resume links don't connect them, and layout scattered them across rows. Schema v3 gains three optional fields: `workItems[]`, `spans[].workItemId` and `links[]` (`fromSpanId → toSpanId` with a free-text `kind`). They are additive (no version bump; traces without them render exactly as before), explicit (a child does not inherit its caller's work item) and never inferred from labels or timing. Work item nesting (`parentId`) is validated but not rendered yet.
27. **Layout keeps a flow on one row where it can.** Among visible siblings, a bar takes its flow predecessor's row (own-item link source, then any link source, then previous step) when the bar and the gap are free, and reserves that row for a pending successor so other siblings don't take it. It is a preference like the resume rule, checked by `check:layout`; steps under different callers cannot share a row and are joined by arrows instead. Layout of large traces costs ~3–6 ms more (7.7k spans, all calls visible).
28. **Bands, not boxes, for work items.** Consecutive same-row steps with nothing between them get one tinted pill with a title line above it, so a band never encloses unrelated bars (the objection to boxes in decision 11). Steps are numbered by badges; explicit links are solid dark arrows (dotted grey stays reserved for pauses); consecutive steps without a link get faint dashed arrows. On stepped bars the run tag shrinks to `↻` so a bar carries one number.
29. **Flow focus and a steps-only view instead of a separate work item view.** Hover/selection focuses a span's flow (its work item plus one hop of links, or a chain of links), `[`/`]` walk the steps, the details panel lists them, and **Steps only** collapses each step's internals through the existing collapse mechanism (and `ExportOptions.compactWorkItems`). No new view mode or layout.

## 2026-10-20 — Shared worktree boxes for sibling calls

30. **Consecutive sibling calls in one worktree share a box.** A box used to hold exactly one subtree, so a pipeline whose orchestrator launches every step itself (scout, build, reviews, fixes in a lane worktree) drew one box per step, even though the steps are one lane's work. The trace is right (the orchestrator is the caller), so the fix is in the drawing, not the data. Layout treats the previous sibling switch into the same worktree as a flow predecessor (lowest tier, after work item and link tiers), so a lane's calls line up on one row with their gaps reserved; regions of sibling switches into the same worktree are then merged while the rectangle spanning them holds no other bar, as with work item bands, so a box still never encloses unrelated bars. The chip shows the ref at the box's start; ref changes inside show as ticks on the bars. Layout of the stress trace costs ~1–3 ms more.

## 2026-10-20 — Band spacing and the work items list

31. **Bands own their space and sit above caller connectors.** With worktree boxes off, nothing but the title line separated a band from neighbouring rows, so pills touched the bars above and below, and caller connectors drawn on top of the bands ran through their titles. Row spacing now reserves the band's padding above and below (worktree boxes include it), causal connectors are drawn before the bands, bands have an opaque tint so lines passing behind are hidden, and a connector into a band step ends at the band's top edge. Handoffs and pause links stay above the bands.
32. **A work items tab, not a second chart.** The side panel gets tabs (Details | Work items) only when the trace has work items. The list shows every work item (also ones hidden by the current view), its time range and its numbered steps; hovering an item focuses its flow in the chart exactly like hovering one of its bars (its steps, their internals and one hop of links, everything else dimmed). The hover is UI state inside `WorkTimeline` (`TimelineSvg.focusWorkItemId`), not a public prop.

