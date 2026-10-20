import type {
	AgentSession,
	AgentSpan,
	WorkTrace,
	WorkSpan,
	GitRef,
	Repository,
	WorkEvent,
	WorkItem,
	WorkLink,
	Worktree,
	WorktreeRefInterval
} from './types.js';

/** Immutable lookups over a validated trace. Never mutates the source. */
export interface TraceIndex {
	trace: WorkTrace;
	spans: Map<string, WorkSpan>;
	sessions: Map<string, AgentSession>;
	events: Map<string, WorkEvent>;
	repositories: Map<string, Repository>;
	worktrees: Map<string, Worktree>;
	/** causal children (parentId only), sorted by (startMs, id) */
	children: Map<string, WorkSpan[]>;
	/** agent spans of each session sorted by (startMs, id) */
	sessionSpans: Map<string, AgentSpan[]>;
	/** ref intervals per worktree sorted by (startMs, id) */
	worktreeRefs: Map<string, WorktreeRefInterval[]>;
	/** span id -> span that resumes it (next activation) */
	nextActivation: Map<string, AgentSpan>;
	workItems: Map<string, WorkItem>;
	/** spans of each work item sorted by (startMs, id) */
	workItemSpans: Map<string, WorkSpan[]>;
	links: WorkLink[];
}

const byStartThenId = (
	a: { startMs: number; id: string },
	b: { startMs: number; id: string }
) => a.startMs - b.startMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function effectiveEndMs(span: WorkSpan, observedUntilMs: number): number {
	return span.endMs ?? observedUntilMs;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
	const list = map.get(key);
	if (list) list.push(value);
	else map.set(key, [value]);
}

export function buildIndex(trace: WorkTrace): TraceIndex {
	const spans = new Map(trace.spans.map((s) => [s.id, s]));
	const children = new Map<string, WorkSpan[]>();
	const sessionSpans = new Map<string, AgentSpan[]>();
	const worktreeRefs = new Map<string, WorktreeRefInterval[]>();
	const nextActivation = new Map<string, AgentSpan>();
	const workItemSpans = new Map<string, WorkSpan[]>();

	for (const s of trace.spans) {
		if (s.parentId !== undefined) push(children, s.parentId, s);
		if (s.workItemId !== undefined) push(workItemSpans, s.workItemId, s);
		if (s.kind === 'agent') {
			push(sessionSpans, s.sessionId, s);
			if (s.resumesSpanId) nextActivation.set(s.resumesSpanId, s);
		}
	}
	for (const r of trace.worktreeRefs) push(worktreeRefs, r.worktreeId, r);
	for (const list of children.values()) list.sort(byStartThenId);
	for (const list of sessionSpans.values()) list.sort(byStartThenId);
	for (const list of worktreeRefs.values()) list.sort(byStartThenId);
	for (const list of workItemSpans.values()) list.sort(byStartThenId);

	return {
		trace,
		spans,
		sessions: new Map(trace.agentSessions.map((s) => [s.id, s])),
		events: new Map(trace.events.map((e) => [e.id, e])),
		repositories: new Map(trace.repositories.map((r) => [r.id, r])),
		worktrees: new Map(trace.worktrees.map((w) => [w.id, w])),
		children,
		sessionSpans,
		worktreeRefs,
		nextActivation,
		workItems: new Map((trace.workItems ?? []).map((w) => [w.id, w])),
		workItemSpans,
		links: trace.links ?? []
	};
}

/** Checked-out ref of a worktree at time t, by interval membership only. undefined = unknown. */
export function refAt(index: TraceIndex, worktreeId: string, t: number): GitRef | undefined {
	return index.worktreeRefs.get(worktreeId)?.find((r) => r.startMs <= t && t < r.endMs)?.ref;
}

export function formatRef(ref: GitRef | undefined): string {
	if (!ref) return 'Unknown';
	return ref.kind === 'branch' ? ref.name : `detached @ ${ref.commitSha.slice(0, 7)}`;
}

/** Agent type that owns a span: its session's type, or the nearest agent ancestor's. */
export function agentTypeOf(index: TraceIndex, span: WorkSpan): string | undefined {
	let cur: WorkSpan | undefined = span;
	const seen = new Set<string>();
	while (cur && !seen.has(cur.id)) {
		seen.add(cur.id);
		if (cur.kind === 'agent') return index.sessions.get(cur.sessionId)?.agentType;
		cur = cur.parentId ? index.spans.get(cur.parentId) : undefined;
	}
	return undefined;
}

/** Causal ancestor chain (nearest first), via parentId only. */
export function ancestorsOf(index: TraceIndex, spanId: string): WorkSpan[] {
	const out: WorkSpan[] = [];
	const seen = new Set<string>([spanId]);
	let cur = index.spans.get(spanId);
	while (cur?.parentId && !seen.has(cur.parentId)) {
		seen.add(cur.parentId);
		cur = index.spans.get(cur.parentId);
		if (cur) out.push(cur);
	}
	return out;
}
