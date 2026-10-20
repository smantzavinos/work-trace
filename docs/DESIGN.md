# Work Trace — Design

How Work Trace models a trace, lays it out and renders it. The decision log is [`DECISIONS.md`](DECISIONS.md). The JSON Schema is [`src/lib/model/work-trace.schema.json`](../src/lib/model/work-trace.schema.json); the sample trace is [`static/sample-trace.json`](../static/sample-trace.json).

## 1. Purpose

**Naming.** The library is **Work Trace** (package `work-trace`); its visualization is the **Work Execution Timeline**, rendered by the `WorkTimeline` component. The root data type is `WorkTrace`, a span is a `WorkSpan`, and a timestamped event is a `WorkEvent`. The name is broader than the current model on purpose; the agent-specific concepts below (agent sessions, resumes, compaction, worktrees) are unchanged.

Create a compact, readable, time-based visualization of hierarchical agent execution, including parallel short-lived subagents, recursive delegation, resumable subagent sessions, context compaction, and Git worktree/branch context. This is **not** a sequence diagram with a permanent column per agent, and **not** a conventional trace waterfall with a permanent row per invocation.

The visual is a **compact causal timeline**:

- **X axis:** elapsed time in milliseconds; overlapping bars show overlapping lifetimes.
- **Y axis:** dynamic, reusable lanes. No lanes reserved for particular agent types, sessions, or tree depths.
- **Bars:** execution spans (agent invocations, optionally tools and model calls).
- **Solid links:** explicit parent-to-child invocation edges (spawn/delegation).
- **Dashed links:** continuity across separate invocations of the *same persistent agent session* (resume).
- **Markers:** session events such as compaction, anchored to the appropriate agent execution when possible.

The source of truth is portable, versioned JSON. The UI must neither require an agent framework nor execute the trace. Git context is **an additional orthogonal grouping dimension**, not a replacement for the causal tree. The primary workflow is **load saved JSON → inspect finished execution → export a static SVG diagram**; live updates are out of scope. The implementation is a **reusable Svelte 5 library**, usable by Svelte/SvelteKit host applications, developed alongside a tiny standalone demo.

## 2. Key domain distinction: type, session, execution span

An agent **type** (e.g. `researcher`) describes a reusable role/configuration. An **agent session** (e.g. `research-17`) is a persistent conversation/context that may be invoked, finish/park, compact, and later resume. An **execution span** (e.g. `research-run-2`) is one time-bounded activation of that session.

Three calls to the same agent type may represent three distinct sessions. Conversely, two separated activations of one session must be represented by **two execution spans with the same `sessionId`**, not by stretching a single rectangle over idle time.

Example lifecycle:

```text
Main agent span  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                       ┌───────────────┐     ┌──────────────┐
Research session A     │ span A1       │     │ span A2      │
                       │ start         │     │ resume       │
                       │  ◆ compact    │     │              │
                       └───────────────┘     └──────────────┘
                         (session persisted between A1 and A2)
```

The gap between A1 and A2 means **not executing**; it does not imply the session was deleted. Compaction is a session event, not a session restart. A1 and A2 may have different `parentId` values if different callers activated them.

### Identity and relationship rules

- `agentSessions[].id`: identity of durable conversation/context; unique within a trace.
- `agentSessions[].agentType`: reusable role. Multiple sessions may share an agent type.
- `spans[].id`: identity of *this execution*, unique within the trace.
- `spans[].sessionId`: required for agent spans; identifies the persistent agent session.
- `spans[].parentId`: **who invoked this execution**; points to another execution span, never to a session. Absent for a top-level execution.
- `spans[].mode`: `start` for first activation; `resume` for later activations.
- `spans[].resumesSpanId`: for `mode: "resume"`, the immediately previous execution span of this same session. This is a **continuity edge**, distinct from parentage.
- `events[].sessionId`: identifies the persistent session to which an event belongs; `spanId` optionally identifies which execution was underway when it occurred.

## 3. Git workspace context: repository, worktree, checked-out ref

Git context is deliberately distinct from the agent identities:

- **Repository:** logical Git repository (`repositories[].id`). One repository can have several worktrees.
- **Worktree:** stable identity of a physical checkout (`worktrees[].id`), with an optional display path and `repositoryId`. A worktree may outlive the invocation using it.
- **Checked-out ref:** branch name or detached HEAD, **time-dependent state of the worktree**, recorded by `worktreeRefs[]`. A branch is not a workspace identity and may change while an agent is running.
- **Execution assignment:** optional `spans[].worktreeId`, attached to each invocation, **not** permanently to `agentSessions[]`. A later resumed invocation can use a different worktree, even with the same session ID and parent.

A missing `worktreeId` means **unknown/unrecorded**. Do not silently infer it from the caller or previous activation. A span may have a single recorded *primary worktree* in v3; simultaneous multi-worktree use or switching worktrees inside one invocation is deferred. This limitation must not be hidden by the viewer.

`worktreeRefs[]` describes observed half-open intervals `[startMs, endMs)` during which a worktree had a checked-out branch or detached HEAD. Adjacent intervals may have different branches; they cannot overlap for the same worktree. No entry for a time means **unknown ref**, not "same as the last observed ref". A branch change midway through an invocation is shown as a small marker/segment on its bar and correctly reflected in inspection at the selected time. Commits on the same branch do not by themselves imply a new ref interval; commit history is not modeled in v3.

### Worktree overlay (one layout)

There is a single compact execution layout (decision 18 superseded the original Execution/Workspace pair). Worktrees are an optional **overlay** on it (`showWorktrees`, default on):

- The worktree of the earliest root span is the **base checkout**. It is not boxed; it is named once in the legend and the export header (`base: Main checkout · main`).
- Every visible subtree whose worktree differs from its visual parent's is packed as a **solid rectangle** (rows × time) that no other bar may enter, and drawn as a light tinted rounded box behind its bars. A label chip on the box's top border shows the worktree label and the ref at the box's start. Boxes can nest. Spans without a `worktreeId` get no box.
- Hovering or clicking a box or chip highlights that worktree and dims everything else.
- Because a box never encloses unrelated bars, the objection to global boxes (false membership) does not arise.

The causal tree, resume relationships and compaction events are unaffected by the overlay. Turning it off does not change rows. The overlay never modifies JSON or invents assignments, and it is included in SVG export.

## 4. Scope and core semantics

### Non-goals

- Live trace ingestion, incremental stabilization of lane positions, or control over executing agents.
- npm registry publishing, a monorepo, a backend, Storybook, a framework-neutral interactive JS/Web Component facade, or a custom Nix-based JavaScript package resolver.
- Editing/dragging nodes, producing orchestration instructions, or persistence/backend.
- Reserved fixed swimlanes per agent role, guaranteed stable Y coordinates across toggles, or globally optimal layout.
- Mandatory token telemetry, inferred compaction times, or inferring real CPU/model activity from session lifetime.
- Automatic cross-agent messages/dependencies not expressible as invocation parentage or resume continuity.

### Core semantics

- **Primary purpose: offline post-execution review.** Load and inspect recorded traces. The viewer is not a real-time dashboard. Layout may be recomputed after importing data, changing filters, or collapsing a branch; there is no obligation to preserve lane stability across snapshots.
- **Exclusive persistent sessions.** A given `sessionId` has **at most one active agent execution at any instant**. A later activation is a resume, with a new span pointing to the immediately prior activation. Its causal `parentId` can be different. Overlaps of agent spans sharing a session ID are invalid, even if the two spans have different callers or invocation labels. At a precise end/start boundary (`previous.endMs === next.startMs`), back-to-back activations are allowed.
- **Dynamic compact lanes.** No permanently reserved row for agent type, persistent session, or recursion depth. A resumed invocation may be laid out on a different lane.
- **Preserve interrupted trace support.** A saved trace may have `status: "running"` spans ending visually at `observedUntilMs` if recording stopped mid-execution. This does *not* imply that the viewer streams or performs real-time updates.
- **Schema revised for Git workspaces.** `schemaVersion: 3` adds repositories, worktrees, worktree ref intervals, and per-span worktree assignment. Exclusive sessions remain a semantic-validation rule.

### Underlying assumptions

This version targets a **saved, completed trace or a saved snapshot of an interrupted run**. Re-layout after a new file loads and visibility changes is acceptable. Each execution span has a single start and either an end or `running` status. A session can have multiple **nonoverlapping** execution spans in chronological order; simultaneously executing the same persisted session is invalid source data.

## 5. JSON contract (version 3)

`src/lib/model/work-trace.schema.json` is authoritative for structural validation (JSON Schema Draft 2020-12). Semantic constraints beyond JSON Schema must be checked by code.

```ts
interface WorkTrace {
  schemaVersion: 3;
  trace: {
    id: string;
    title?: string;
    startedAt?: string;         // ISO 8601 instant, optional reference clock
    observedUntilMs: number;    // required snapshot watermark
  };
  repositories: Repository[];
  worktrees: Worktree[];
  worktreeRefs: WorktreeRefInterval[];
  agentSessions: AgentSession[];
  spans: WorkSpan[];
  events: WorkEvent[];
  workItems?: WorkItem[];      // optional, see "Work items and handoff links"
  links?: WorkLink[];          // optional handoffs between spans
}

interface Repository {
  id: string;
  label?: string;
  remoteUrl?: string;         // optional, potentially sensitive
  attributes?: Attributes;
}

interface Worktree {
  id: string;
  repositoryId: string;
  label?: string;
  path?: string;              // optional, may be relative or omitted for privacy
  kind?: 'main' | 'linked' | 'unknown';
  attributes?: Attributes;
}

type GitRef = { kind: 'branch'; name: string }
            | { kind: 'detached'; commitSha: string };

interface WorktreeRefInterval {
  id: string;
  worktreeId: string;
  startMs: number;           // inclusive
  endMs: number;             // exclusive
  ref: GitRef;
}

interface AgentSession {
  id: string;                  // persistent within this trace
  agentType: string;           // role/configuration e.g. "researcher"
  label?: string;              // display name e.g. "API Research"
  attributes?: Attributes;
}

type WorkSpan = {
  id: string;
  parentId?: string;           // causal invoking span; absent for roots
  worktreeId?: string;         // primary checkout for this execution; not session-scoped
  workItemId?: string;         // optional: the work item this span serves; never inherited
  kind: 'agent' | 'tool' | 'model';
  label?: string;              // optional per-execution display name
  startMs: number;
  endMs?: number;              // absent iff status='running'
  status: 'running' | 'ok' | 'error' | 'cancelled';
  attributes?: Attributes;
} & (
  | {
      kind: 'agent';
      sessionId: string;
      mode: 'start' | 'resume';
      resumesSpanId?: string;  // required iff mode='resume'
    }
  | {
      kind: 'tool' | 'model';
      parentId: string;
      label: string;
    }
);

interface WorkEvent {
  id: string;
  kind: 'compaction';
  sessionId: string;
  spanId?: string;              // optional active agent execution anchor
  atMs: number;                // time compaction starts, or point-in-time if end unknown
  endMs?: number;              // if measured as a time interval, > atMs
  trigger?: 'automatic' | 'manual' | 'unknown';
  outcome?: 'ok' | 'error' | 'unknown';
  tokensBefore?: number;
  tokensAfter?: number;
  label?: string;
  attributes?: Attributes;
}

interface WorkItem {
  id: string;
  label: string;
  parentId?: string;           // another work item (nesting; not rendered yet)
  attributes?: Attributes;
}

interface WorkLink {
  id: string;
  fromSpanId: string;          // e.g. the implementation
  toSpanId: string;            // e.g. its review; must not start before fromSpanId
  kind?: string;               // free text shown on the arrow: "review", "fixes", ...
  attributes?: Attributes;
}

type Attributes = Record<string, string | number | boolean | null>;
```

The top-level object is named `trace` instead of `session` to avoid confusing the overall recorded timeline with an individual persistent agent session. Version **3** adds workspace records and is a breaking change from v2. Do not silently parse v1/v2 as v3; a future importer can offer an explicit migration which adds empty workspace arrays and leaves assignments unknown.

### Work items and handoff links (optional)

Parent/child and resume links say *who called whom* and *which runs are one session*; they do not say *which work a span serves* or *who acted on whose output*. A plan → review → fixes stream is often spread across sibling sessions and agent types. Three optional, additive fields record it (absent everywhere = the trace renders exactly as before):

- `workItems: [{ id, label, parentId?, attributes? }]`: the units of work (a feature, a ticket, a plan step). `parentId` allows nesting; it is not rendered yet.
- `spans[].workItemId`: the work item a span serves. Explicit and never inherited: an untagged child of a tagged span is not a member (it is still drawn inside its caller's step).
- `links: [{ id, fromSpanId, toSpanId, kind?, attributes? }]`: explicit handoffs, e.g. `kind: "review"` from an implementation to its review, `kind: "fixes"` from the review to the fix run. `kind` is free text shown on the arrow. Links are independent of `parentId` and `resumesSpanId`.

The producer must emit these; the viewer never infers work items or handoffs from labels or timing.

### Representative JSON (excerpt)

```json
{
  "schemaVersion": 3,
  "trace": { "id": "demo", "observedUntilMs": 200000 },
  "repositories": [{ "id": "repo", "label": "Application" }],
  "worktrees": [
    { "id": "wt-main", "repositoryId": "repo", "label": "Main" },
    { "id": "wt-feature", "repositoryId": "repo", "label": "Feature worktree" }
  ],
  "worktreeRefs": [
    { "id": "ref-main", "worktreeId": "wt-main", "startMs": 0, "endMs": 200000, "ref": { "kind": "branch", "name": "main" } },
    { "id": "ref-feature", "worktreeId": "wt-feature", "startMs": 80000, "endMs": 200000, "ref": { "kind": "branch", "name": "feat/notifications" } }
  ],
  "agentSessions": [
    { "id": "main-session", "agentType": "orchestrator" },
    { "id": "research-session", "agentType": "researcher" }
  ],
  "spans": [
    { "id": "main-1", "kind": "agent", "sessionId": "main-session", "mode": "start", "startMs": 0, "endMs": 200000, "status": "ok", "worktreeId": "wt-main" },
    { "id": "research-1", "kind": "agent", "parentId": "main-1", "sessionId": "research-session", "mode": "start", "startMs": 10000, "endMs": 40000, "status": "ok", "worktreeId": "wt-main" },
    { "id": "research-2", "kind": "agent", "parentId": "main-1", "sessionId": "research-session", "mode": "resume", "resumesSpanId": "research-1", "startMs": 100000, "endMs": 145000, "status": "ok", "worktreeId": "wt-feature" }
  ],
  "events": [
    { "id": "compact-1", "kind": "compaction", "sessionId": "research-session", "spanId": "research-1", "atMs": 30000, "tokensBefore": 50000, "tokensAfter": 15000, "trigger": "automatic" }
  ]
}
```

See `sample-trace.json` for a richer, full three-plus-level example including concurrent same-type sessions, a resumed session, two compactions, tool/model calls, detached execution, a failure, and a running span.

### Structural rules

- All identifiers are nonempty strings. IDs are unique within their respective collections. `repositories`, `worktrees`, and `worktreeRefs` arrays are required but may be empty when Git context was not recorded.
- Every `worktrees[].repositoryId` must reference a repository, and every supplied `spans[].worktreeId` and `worktreeRefs[].worktreeId` must reference a worktree. The same `worktreeId` may be used by many simultaneous spans (shared checkout), with no exclusivity requirement. Distinct worktrees may share a repository.
- Each worktree ref interval has `startMs < endMs <= observedUntilMs`; intervals for the same worktree must not overlap. Adjacent intervals and gaps are valid; gaps denote unknown checked-out ref. Branch names are metadata, not stable identifiers. A single span may intersect multiple ref intervals (checkout changed during execution).
- Timestamps are finite nonnegative milliseconds relative to the trace origin; recorded ends must be **strictly greater** than starts.
- `trace.observedUntilMs` is present and >= each observed span start/end and event start/end.
- Every completed span requires `endMs`. A `running` span **must not** provide `endMs`; display its temporary end at the observation watermark.
- Agent spans must refer to an existing `agentSessions[].id`. Tools and model spans require a `parentId`, but have no `sessionId`, `mode`, or `resumesSpanId`; their owning session is found by walking their ancestors.
- `mode: "start"` excludes `resumesSpanId`; `mode: "resume"` requires it.
- Compaction events require `sessionId`. `spanId` is optional and, if given, must identify an agent execution of that exact session.
- `endMs` on a compaction event is optional: absent means **instantaneous/unknown duration**, not a claim that it took zero time.
- Unknown structural properties are rejected in v3; arbitrary scalar source metadata belongs in `attributes`.

### Semantic validation (code, not just schema)

1. Index all spans, sessions, events; reject duplicate IDs and unresolved references.
2. Validate temporal ranges and the trace watermark.
3. Reject parent-child self-links and causal parent cycles. A child's **start** must fall within the parent's observed lifetime (`parent.startMs <= child.startMs <= parent.effectiveEndMs`); the child may outlive the parent (detached execution).
4. Validate session continuity separately from parentage: `resumesSpanId` must reference an **agent** span of the same `sessionId`, with a completed end not after the new span's start. The session's first span must be `start`. All later spans must be `resume` and link to the *immediately prior chronological span* of that session. Sort spans of each session by `(startMs, id)` for checks; require `previous.endMs <= next.startMs`; a `running` span cannot have any later activation in that session. Reject all overlapping runs of the same session, even under different parents. Zero-gap back-to-back runs are valid.
5. Resumption is not a causal parent. A resume link may cross parent subtrees and must not be included when calculating tree depth, collapse membership, or parent-cycle checks.
6. For a compaction with `spanId`, its timestamp and any `endMs` must lie within that agent span's observed lifetime; the `sessionId` must match. If no `spanId` is supplied, find an execution of the session active at `atMs` as an **inferred visual anchor only**. If none exists, keep the event in a fallback events strip/details panel; never fabricate an execution span.
7. For compaction token metrics, both counts are optional nonnegative integers. Do not require `tokensAfter <= tokensBefore`: accounting conventions can differ. Never infer tokens or a successful compaction from a label.
8. Validate Git cross-references and timestamp ranges. For each worktree, sort ref intervals by `(startMs, id)`; reject overlaps, allow boundary-touching intervals and unknown gaps. Resolve branch/ref at time `t` by interval membership only. Do not infer a missing worktree from parent/resume, or a missing branch from preceding intervals.
9. Work items and links: unique ids; `spans[].workItemId` and `workItems[].parentId` must resolve; no work item parent cycles; link endpoints must resolve, differ, and the target must not start before the source.
10. Preserve input source and stable IDs; layout, grouping, and filters are derived views, never destructive transformations of the JSON.

## 6. Visual specification

### Geometry

For every visible span:

```text
x = leftMargin + (startMs - viewportStartMs) * pxPerMs
width = max(3px, (effectiveEndMs - startMs) * pxPerMs)
y = topMargin + lane * lanePitch
height ≈ 20px; lanePitch ≈ 27px
```

Use actual time intervals (not artificially widened graphics) for collision detection. Relative elapsed-time grid intervals adapt to zoom. `effectiveEndMs = span.endMs ?? trace.observedUntilMs`.

Bar height and row pitch scale with a view-only **density** (1 = the sizes above, down to 0.15; see §8 zoom). Density changes pixel geometry only, never rows.

### No fixed rows by agent type

All invocations compete for a shared compact lane pool, with these guarantees:

- Two overlapping visible bars never occupy the same lane.
- A visible child is strictly below its nearest **visible** causal parent (`child.lane > parent.lane`).
- A lane can be reused by a different session or agent type after the prior span ends.
- Separate activations of the same persistent session **may use different lanes**; continuity is conveyed with metadata/highlighting/dotted links, not vertical position. As a readability preference (not a guarantee), a resumed run whose previous run is a sibling reuses that run's row when the run and the pause before it are free.
- Lane allocation is deterministic for identical data and filters; no requirement for stability when filters/collapse change.

Color is associated with `agentType` (deterministic palette assignment). Distinct sessions of a shared type use the same base color but are separately selectable. Runs of a multi-run session have a chevron right edge (paused), a notch left edge (resumed), and an `n/N` run tag before the label. Status uses border/line treatment so color alone never carries meaning.

### Git context rendering

Bar fill continues to encode agent type; worktree identity is carried by the overlay boxes (§3), not by per-bar stripes or badges. Highlighting one worktree must reveal every assigned span, even across distinct causal branches. Show missing assignments explicitly as `Unknown` in details, not the caller's worktree. Branch/ref intervals determine the correct label at each timestamp; a ref change inside a span appears as a slim tick on the bar.

### Three relationship layers

**Causal invocation:** subdued solid fork connector from the caller's bar at the callee's start X position, to the callee bar. If a child persists after its parent ends, do not try to draw a connector at the child's end.

**Session continuity:** a dotted link from the prior run's end to the resumed run's start, always drawn in neutral grey and accented when the session is hovered or selected (hovering one run outlines all runs of its session). Its shape depends on what is in the way: a straight line with a `paused 42s` pill when the gap on the row is clear, a bracket above the row when the same row is occupied in between, otherwise a curve across rows. Show a prior/next activation control in the details panel. This link does **not** imply the session was executing during the gap.

**Compaction:** a diamond/chevron marker (`◆`) positioned at event `atMs` on the matching agent bar. For known duration, draw a subtle overlay from `atMs` to `endMs` in addition to the marker. Marker click opens event details and associated session; visually distinguish failure. If event has no associated active span, show a compact event-strip marker aligned with the global time axis and indicate that it is not attached to an active run. Events are annotations; they do **not** occupy agent execution lanes.

### Work items and handoffs

A **step** of a work item is a visible span tagged with it that has no visible ancestor tagged with the same item; steps are numbered in start order.

- **Bands:** consecutive steps of one work item that share a row, with nothing else between them in that row, sit on one soft tinted pill in the work item's colour (layout guarantees no other bar is inside it; see §7). A work item split across rows gets one band per row. The band's title (`Notifications backend · 3 steps`, later bands `(cont.)`) sits on its own line just above the bars, inside any worktree box, and sticks to the left edge while the band is scrolled partly out of view. Titles are hidden below label density.
- **Step badges:** work items with two or more steps number their steps with a small disc in the work item's colour before the label. On a stepped bar the run tag shortens to `↻` (the run edges and pause link still show the session).
- **Handoff arrows:** each explicit link is a solid dark arrow from the source's end to the target's start, mapped to the nearest visible ancestor when an endpoint is hidden or collapsed. Straight with a `kind` pill when both bars share a clear row, an arc over the row when something sits between, otherwise a curve across rows. Consecutive steps without an explicit link get a faint dashed arrow. Dotted grey stays reserved for pauses.
- **Focus:** hovering or selecting a span focuses its flow: its work item's spans plus spans linked to them (one hop), or for an untagged span its chain of links. Their bars are outlined in the work item colour, their arrows and band are emphasized, and with a selection everything outside the flow, the lineage and the session dims.

Limitation: only siblings (same visible caller) can share a row, so steps run by different callers stay on different rows, connected by arrows.

### Selection and details

On selecting a bar, show span ID, label, role, session ID, call mode, invocation parent, ancestor path, previous/next session activation, start/end/duration, status, direct children, compactions during the run, and attributes. Show the selected invocation's worktree, repository, optional path, and checked-out ref at invocation start and relevant ref transitions, or `Unknown` when not recorded. Highlight the selected causal ancestry and session-continuity links. Distinct sessions with the same type must remain easy to disambiguate.

When the span is (inside) a work item step or has links, a **Work item** section shows the item, `step k of n` with previous/next buttons, the numbered step list, and incoming/outgoing handoffs with their kind.

On selecting compaction, show session ID, anchor run if known, timestamp/duration, trigger/outcome/token counts when present, and attributes. Avoid implying an unknown token count is zero.

### Dense-session usability

Bars too narrow to label should remain selectable through a minimum hit target (which can be wider than the visible bar). Prefer line/marker indicators and details rather than forced labels on tiny spans: a label is drawn inside the bar, after it when there is room, or ellipsized only while at least ~6 characters survive; otherwise it is omitted (the native tooltip always has the full label). Worktree chips degrade to a dot the same way. Reuse Y lanes heavily; provide vertical scrolling when there are many simultaneous invocations. Include a grouped legend (Agents, Calls, Status, Sessions, Git; only what occurs in the trace) *without* imposing agent-type rows.

At scale (thousands of tool/model calls):
- **Clusters:** in one row, three or more bars each narrower than 6px and at most 4px apart are drawn as one hatched strip with a summary tooltip (`212 tools, 40 model calls · 1:02–1:40`). Clicking it zooms to its time range. Selected and highlighted bars are never clustered.
- **Culling:** bars outside the horizontal viewport, or more than a screen above/below the scrolled area, are not rendered (export renders everything).
- **Density levels:** below density 0.85 worktree chips are hidden; below 0.7 labels and pause pills are hidden. Boxes, bars, links and markers remain.

Known limit: with 1–2k individually visible bars (deep zoom into a dense call region), a zoom step costs ~150–250 ms, dominated by DOM updates; a canvas layer for call bars is the next step if that matters.

## 7. Layout algorithm (pure/deterministic)

Implement separately from HTML/SVG:

```ts
computeLayout(trace, {
  showTools: false,
  showModelCalls: false,
  collapsedSpanIds: new Set<string>(),
  hiddenAgentTypes: new Set<string>()
}) => {
  items: Array<{
    id: string;
    row: number;
    depth: number;
    visualParentId?: string;
    startMs: number;
    effectiveEndMs: number;
  }>;
  totalLanes: number;
  worktreeRegions: Array<{ worktreeId: string; rootSpanId: string; rowStart: number; rowEnd: number; startMs: number; endMs: number; depth: number }>;
  resumeEdges: Array<{ fromSpanId: string; toSpanId: string }>;
  workItems: Array<{ workItemId: string; label: string; stepIds: string[] }>;
  workItemBands: Array<{ workItemId: string; row: number; startMs: number; endMs: number; stepIds: string[]; first: boolean }>;
  handoffs: Array<{ fromSpanId: string; toSpanId: string; kind?: string; implicit: boolean }>;
  positionedEvents: Array<{
    eventId: string;
    anchorSpanId?: string;
    position: 'bar' | 'event-strip';
  }>;
}
```

1. Semantic-validate and index the input.
2. Build the causal parent forest **using `parentId` only**. Calculate canonical depth and descendants. Do *not* treat `resumesSpanId` as a parent.
3. Determine visible bars: hiding tool/model spans should reparent their children **visually** to the nearest visible ancestor. Collapse hides only causal descendants of the collapsed span; it must **not** automatically hide a later resume elsewhere in the tree. For hidden agent types, hide their bars and reattach descendants visually as above.
4. Determine visible parent/depth for each remaining bar. Sort by `(startMs ASC, visibleDepth ASC, id lexicographic ASC)` so parents precede descendants at equal timestamps.
5. Subtree packing: pack each visible subtree as a block (its bar on row 0, children placed below at the lowest non-colliding offset, in start order). A child subtree in a different worktree from its owner is placed as a solid rectangle so its worktree box stays clean. **Flow rows:** a bar's *flow predecessor* is, among its visible siblings, a link source in its own work item, else any link source, else the previous step of its work item, taking in each tier the candidate that ended last before the bar started (overlapping work has none). A bar takes its flow predecessor's offset when the bar and the gap since the predecessor ended are free there; while a successor is pending, its gap and shape on the predecessor's row are reserved, and other siblings avoid them. Failing that, a resumed sibling run takes its previous run's offset when the run and the pause gap are free there. Rows are then absolute offsets from the parent's row.
6. Match events by explicit `spanId`, then (if absent) by unique session activation active at event time, otherwise mark as `event-strip`.
7. Generate resume edges from `resumesSpanId`, but do not allocate lanes or enforce ancestry based on those edges. Compute link routing at render time from positioned bars.
8. Derive work item steps, bands (consecutive same-row steps with nothing between) and handoffs (explicit links mapped to visible bars, deduplicated per pair, plus implicit arrows between consecutive steps without one).
9. Derive worktree regions from the packed blocks (one per worktree switch; the base worktree and unknown assignments get none). Worktree overlay never rewrites `parentId` or `resumesSpanId`.
10. Compute the checked-out ref at each relevant timestamp by intersecting the worktree's ref intervals; create tick markers for ref boundaries that cross a span. No worktree ref interval means unknown, and no span worktree assignment means unassigned.
11. Recompute positions after visibility/collapse changes, or when loading a different snapshot, but **do not recompute on zoom/pan**.

This greedy layout is intentionally not globally optimal; it maximizes simplicity and determinism while packing non-overlapping bars into reusable lanes. Measured with `pnpm stress-trace` (7,710 spans, 183 sessions, 21 worktrees): layout ≈ 8 ms with agents only, ≈ 26 ms with every call visible. `pnpm check:layout` asserts the invariants (no overlap, children below parents, clean worktree boxes, flow and resumed rows, bands holding only their steps, determinism under shuffle, boxes contain their bars at every density) on the sample and 2,000 fuzzed traces with work items and links. Complexity is approximately `O(N * numberOfLanes)` and can be optimized later without changing the data contract.

### Renderer layers, back-to-front

1. Background, ruler/grid, optional fallback event strip, and worktree overlay boxes (chips are drawn in a top layer so bars never cover them).
2. Work item bands and their titles.
3. Faint causal links for visible spans (possibly selection-only when crowded).
4. Handoff arrows and session resume links.
5. Time bars, step badges, Git ref boundary ticks, and status accents.
6. Compaction/event markers and accessible hit areas.
7. Selected-lineage overlays and tooltips (HTML overlay acceptable).

Use stable keyed DOM elements (`data-span-id`, `data-event-id`) to make interactions/test assertions unambiguous.

## 8. UI interactions

Toolbar: **Open JSON**, **Export SVG**, **Fit time**, **Overview**, zoom −/+, previous/next step and **Steps only** (when the trace has work items), Show Tools, Show Model Calls, Show Connectors, Show Worktrees; worktree and base entries in the legend act as highlight toggles.

- **Zoom:** Ctrl/⌘+wheel or pinch zooms at the pointer; Shift+wheel or horizontal wheel pans; `+`/`−`/`0`. Zooming in goes to at least 200 px/s. Zooming **out past Fit** compacts rows instead (density, down to 0.15: shorter bars, then no chips, then no labels); zooming in restores density before time. **Overview** (`9`) fits time and picks the largest density at which every row fits the visible height. Wheel input is coalesced to one update per animation frame.

- Click worktree badge or group header: highlight/filter that worktree; selection details show repository, worktree identity, branch at time, and transitions. A resumed session may move between worktrees.
- Click bar: select and inspect. Esc: clear selection. Double-click bar: collapse its causal descendants.
- `[` / `]` (or ‹ › in the toolbar and details panel): select and reveal the previous/next step of the selected span's work item; with nothing selected, `]` goes to the first step.
- **Steps only:** collapses every work item span that has children, leaving the flow of steps; toggle again to restore them (double-click still expands one step). `ExportOptions.compactWorkItems` does the same for exports.
- Click compaction marker: inspect compaction. Hover reveals short duration/metrics summary.
- Click previous/next activation in details: select it and pan to it; *do not* infer it has the same causal parent.
- Zoom anchored at pointer; drag empty background to pan. Provide keyboard/toolbar equivalents. Vertical scroll for many simultaneous lanes.
- JSON import via browser File API and drag-and-drop. Bundled fixture must be usable in an offline static page; do not depend on network fetch or an application backend.
- When toggling visibility, preserve selected IDs when still present and preserve horizontal viewport where possible.
- **Export SVG:** serialize the current *visibility and collapse state* as a self-contained static chart, fit horizontally to the complete trace extent rather than the current pan/zoom crop. Include timeline labels, visible spans, connectors when enabled, compaction markers, and worktree/ref context (worktree overlay boxes), with an embedded legend. Do not serialize hover state, a floating tooltip, the HTML inspection panel, scripts, or remote assets. Include a document title and stable IDs so the result can be viewed in a browser or included in technical documentation. Export should work entirely offline.

Accessibility/privacy: SVG labels or accessible invocation/event list, keyboard focusable selections, non-color status cues, safe `textContent` for imported strings, no `innerHTML` interpolation, no external network calls.

## 9. Library architecture and repository structure

The implementation is **one dedicated Git repository**, containing **one Svelte 5 component library** and **one small SvelteKit demo route**. Do not split into a monorepo or build a second application/package solely for the demo. SvelteKit's library packaging workflow already supports publishing `src/lib` as a package while `src/routes` remains a demo. An npm registry account and npm publication are **not required**.

The source tree is listed in the README.

### Module boundaries

1. **Model (`model/`)**: Plain TypeScript, no Svelte runtime, no browser globals. JSON Schema v3 is canonical; semantic validation covers session exclusivity, resumption, causal parentage, compaction, and worktree/ref consistency. Parsing never mutates the supplied trace. 
2. **Layout (`layout/`)**: Plain TypeScript and deterministic, with no DOM/Svelte imports. Takes an already validated trace plus an explicit view/filter/collapse configuration, builds a scene of rectangles, labels, connectors, event anchors, and bounds. Geometry reflects the selected view. Use the same derived scene for interactive rendering and SVG export.
3. **Svelte presentation (`components/`)**: Svelte 5 components render scene primitives as native `<svg>` elements, implement selection, zoom, pan, and accessible hit targets. The library's main component can hold local transient UI state; do not introduce a global store, state-management dependency, or charting framework.
4. **Demo (`routes/`)**: Only the demo handles file import, sample-data loading, toolbar, and download. Configure it to build as a static/prerendered site (using the appropriate SvelteKit static adapter) so it requires no backend. An embedding host should not inherit the demo's toolbar or file picker. The exported library must not use SvelteKit-specific `$app` modules or route imports, so it can work in Svelte applications without SvelteKit.

Layout should not produce HTML strings and must not own pointer events. Rendering should not make lane-allocation decisions. Keep sorting and stable IDs explicit in unit tests. Separate domain JSON from UI presentation state; selection, viewport, and collapsed groups are not saved back into the trace by default.

### Public API

Expose a **single package root** (`work-trace`) through `src/lib/index.ts`. Treat internal components and module paths as private implementation details. Typed contract:

```ts
interface WorkTimelineProps {
  trace: WorkTrace;               // previously validated JSON schema v3 data
  selectedSpanId?: string | null;          // controlled when supplied (even null)
  onSpanSelect?: (spanId: string | null) => void;
  onEventSelect?: (eventId: string | null) => void;
  showTools?: boolean;                     // default false
  showModelCalls?: boolean;                // default false
  hiddenAgentTypes?: readonly string[];
  highlightedWorktreeId?: string | null;   // controlled when supplied (even null)
  onWorktreeSelect?: (worktreeId: string | null) => void;
  showConnectors?: boolean;                // default true
  showWorktrees?: boolean;                 // default true
}

// root exports:
// WorkTimeline (component), WorkTimelineProps, the model types (WorkTrace, AgentSpan, ...)
// validateTrace(input: unknown): ValidationResult<WorkTrace>   (precompiled Ajv, CSP-safe)
// exportTimelineSvg(trace, options?: ExportOptions): string             (browser only)
```

The exact exported TS shape should follow the generated Svelte 5 template and be kept type-safe. The `selectedSpanId` prop, when supplied, is controlled by the host; without it the component manages selection internally. Selection callbacks notify the host but are not required for normal use. The demo may show more controls, but **avoid publishing demo state/UI as part of `WorkTimeline`**. Keep the public API small; `computeLayout` is internal.

Example use from a Svelte host:

```svelte
<script lang="ts">
  import { WorkTimeline, type WorkTrace } from 'work-trace';
  let { trace }: { trace: WorkTrace } = $props();
</script>

<WorkTimeline {trace} onSpanSelect={(id) => console.log(id)} />
```

Host applications can load trace JSON from their own file, backend, or assets, and should validate untrusted data before handing it to the component. Library rendering must not make external network requests.

### SVG export and non-Svelte embedding

One scene/geometry pipeline must drive both screen SVG and exported SVG. Export shows the full trace time range with current filter/collapse/overlay state, independent of interactive zoom/pan. Include styles and visible labels in the output itself, remove scripts/remote assets/foreign objects, and sanitize imported labels. A browser-based serialization strategy is acceptable, provided it generates the export from the same scene without clipping or leaking interactive attributes. Any plain HTML page can embed the exported SVG as a static image. **Interactive** non-Svelte embedding (Web Component or mount API) is deferred until there is a concrete consumer.

## 10. Packaging and consumption (without npm publishing)

**Default:** Git-hosted package dependency managed by pnpm; tag or commit pin it. **Nix manages the development toolchain**, not Svelte imports or JavaScript dependencies. This avoids a custom Nix output/package derivation and an npm registry release pipeline. Add `private: true` to the library manifest to prevent accidental publication. A typical library manifest contains a `name`, `version`, `type: module`, `files: ["dist"]`, a root `exports` map pointing at built declarations/JS, a Svelte 5 peer dependency, and the generated Svelte packaging scripts. Follow the generated `@sveltejs/package` setup rather than manually inventing package entry points.

**Library scripts:** `package` runs `svelte-package` (with any generated sync/typecheck steps); a Git-install `prepare`/`prepack` step may be used to create `dist` from repository source. Check actual pnpm behavior: Git package lifecycle scripts have varied across pnpm versions, and newer versions may require explicit trusted build-script approval (for example `allowBuilds` in `pnpm-workspace.yaml`). Do **not** assume a Git dependency automatically builds. Test the full installation in a separate consumer and document the necessary trusted-package configuration. If that becomes fragile, a documented prebuilt Git tag or pinned local path dependency is a fallback — not a reason to introduce Nix packaging prematurely.

In a second Svelte/SvelteKit repository:

```bash
pnpm add github:YOUR_ORG/work-trace#v0.1.0
# Or, while editing two local checkouts:
pnpm add ../work-trace
```

These are alternative installation methods, not commands to run together. The consumer imports from `work-trace` as a normal package. Pin Git tags/commits and commit the **consumer's** pnpm lockfile. The library repo also commits its pnpm lockfile. A local link may require `pnpm run package --watch` in the library; test the normal dev-server flow instead of assuming watch propagation.

**Nix flake:** Keep a small `devShell` exposing compatible Node, pnpm, and Git. Use `nix develop` to enter the shell, `pnpm install --frozen-lockfile` for reproducible package installation, and normal pnpm scripts to develop/package/test. Commit `flake.lock` and `pnpm-lock.yaml`; their pins solve different problems. There is no Nix flake output for the JavaScript library. Never embed absolute `/nix/store/...` paths or development checkout paths in distributable imports.

**Integration smoke test:** Scaffold a separate minimal SvelteKit app outside this repository; install a committed Git tag/commit of the library, handle any pnpm Git build approval deliberately, import `WorkTimeline`, render `sample-trace.json`, and verify typecheck, build, and actual SVG output. This should also catch accidentally bundled demo routes, unresolved SvelteKit-only aliases, or missing declaration files. It is a manual test; the latest run is recorded in the README.

**Useful references:** https://svelte.dev/docs/kit/packaging ; https://pnpm.io/package-sources .

## 11. Open questions

1. **Should sequential turns within a single active invocation be separate visual intervals?** v3 only distinguishes session activations (spans). Later an optional activity-state layer can show waiting, model work, tool calls, and idleness.
2. **Can traces be partial or stitched across log files?** v3 requires the first activation of each included session to be `start`; a later version could support external predecessors and partial histories.
3. **Does compaction always occur during an active invocation?** The contract permits no anchor and defines an event-strip fallback; measure real source logs before optimizing layout.
4. **Are external messages/cross-session dependencies important?** If so, add a `links` collection; don't overload `parentId` or `resumesSpanId`.
5. **Future live monitoring:** explicitly out of scope. If needed later, handle stable lane reservations, incremental event ingestion, and updates to running spans as a separate design.
6. **Future concurrent access to one persisted session:** explicitly out of scope. Supporting concurrent readers/writers would require explicit conflict/branch semantics and a contract change.
7. **Multi-worktree activity within a single execution:** v3 describes one primary worktree per span; if traces demonstrate meaningful worktree switching inside an invocation or multiple simultaneous worktrees, add per-span timed workspace assignments. Do not stretch a span across multiple worktree boxes without explicit data.
8. **Commits, merges, and worktree lifecycle:** v3 tracks branch/HEAD checkout state only, not creation/deletion, per-commit HEAD changes, merge edges, or dirty-state annotations. These can be added as later optional event kinds.

### Design trade-off to verify visually

A strict `child.lane > parent.lane` rule preserves causal depth but can create extra lanes for wide overlap patterns. Start with it. If representative traces become excessively tall, experiment with a focused/selected-lineage view or per-depth compact tracks rather than prematurely building an unconstrained graph-layout engine. Real trace fixtures, not abstract aesthetics, should drive that decision.
