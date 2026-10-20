// Pure selection/lineage helpers over the trace index.
import { ancestorsOf, type TraceIndex } from '../model/indexes.js';
import type { TimelineScene, WorkItemSteps } from './compute-layout.js';
import type { WorkSpan } from '../model/types.js';

/** Owning session id: the span's own session, or the nearest agent ancestor's. */
export function sessionIdOf(index: TraceIndex, spanId: string): string | undefined {
	let cur = index.spans.get(spanId);
	const seen = new Set<string>();
	while (cur && !seen.has(cur.id)) {
		seen.add(cur.id);
		if (cur.kind === 'agent') return cur.sessionId;
		cur = cur.parentId ? index.spans.get(cur.parentId) : undefined;
	}
	return undefined;
}

export function spanLabel(index: TraceIndex, span: WorkSpan): string {
	if (span.label) return span.label;
	if (span.kind === 'agent') {
		const s = index.sessions.get(span.sessionId);
		return s?.label ?? s?.agentType ?? span.id;
	}
	return span.id;
}

/** All causal descendants (parentId only). */
export function descendantIds(index: TraceIndex, id: string): string[] {
	const out: string[] = [];
	const stack = [id];
	while (stack.length) {
		const cur = stack.pop()!;
		for (const c of index.children.get(cur) ?? []) {
			out.push(c.id);
			stack.push(c.id);
		}
	}
	return out;
}

export interface Flow {
	/** work items the span belongs to (its own, or its nearest tagged ancestor's) */
	workItemIds: ReadonlySet<string>;
	/** the work item's spans plus spans linked to them (link-only flows: the link chain) */
	spanIds: ReadonlySet<string>;
	/** spanIds and all their causal descendants */
	members: ReadonlySet<string>;
}

const NO_FLOW: Flow = { workItemIds: new Set(), spanIds: new Set(), members: new Set() };

/**
 * The flow a span takes part in. Anchored at the span or its nearest ancestor that is tagged
 * with a work item or has handoff links: a work item yields all its spans plus the spans
 * linked to them (one hop, so a shared reviewer doesn't pull in every other work item);
 * an untagged span yields its chain of links. Empty when the trace has neither.
 */
export function flowOf(index: TraceIndex, spanId: string | null | undefined): Flow {
	if (!spanId || (!index.workItems.size && !index.links.length)) return NO_FLOW;
	const adj = new Map<string, string[]>();
	for (const l of index.links) {
		adj.set(l.fromSpanId, [...(adj.get(l.fromSpanId) ?? []), l.toSpanId]);
		adj.set(l.toSpanId, [...(adj.get(l.toSpanId) ?? []), l.fromSpanId]);
	}
	let anchor = index.spans.get(spanId);
	const seen = new Set<string>();
	while (anchor && !seen.has(anchor.id) && anchor.workItemId === undefined && !adj.has(anchor.id)) {
		seen.add(anchor.id);
		anchor = anchor.parentId ? index.spans.get(anchor.parentId) : undefined;
	}
	if (!anchor || seen.has(anchor.id)) return NO_FLOW;
	const workItemIds = new Set<string>();
	const spanIds = new Set<string>();
	if (anchor.workItemId !== undefined) {
		workItemIds.add(anchor.workItemId);
		const own = (index.workItemSpans.get(anchor.workItemId) ?? []).map((s) => s.id);
		for (const id of own) spanIds.add(id);
		for (const id of own) for (const n of adj.get(id) ?? []) spanIds.add(n);
	} else {
		const stack = [anchor.id];
		while (stack.length) {
			const cur = stack.pop()!;
			if (spanIds.has(cur)) continue;
			spanIds.add(cur);
			stack.push(...(adj.get(cur) ?? []));
		}
	}
	const members = new Set(spanIds);
	for (const id of spanIds) for (const d of descendantIds(index, id)) members.add(d);
	return { workItemIds, spanIds, members };
}

/** Where a span sits in its work item's visible steps: itself a step, or inside one. */
export interface StepPosition {
	workItem: WorkItemSteps;
	/** 0-based index of the step that is or contains the span */
	index: number;
	prevId?: string;
	nextId?: string;
}

export function stepPosition(scene: TimelineScene, spanId: string | null | undefined): StepPosition | undefined {
	for (let id = spanId ?? undefined; id; id = scene.itemById.get(id)?.visualParentId) {
		for (const w of scene.workItems) {
			const index = w.stepIds.indexOf(id);
			if (index >= 0) return { workItem: w, index, prevId: w.stepIds[index - 1], nextId: w.stepIds[index + 1] };
		}
	}
	return undefined;
}

/** Spans that "Steps only" collapses: work item spans with causal children. */
export function stepsOnlyCollapse(index: TraceIndex): string[] {
	return [...index.workItemSpans.values()].flat().flatMap((s) => (index.children.has(s.id) ? [s.id] : []));
}

export interface Highlight {
	active: boolean;
	selectedId: string | null;
	/** selected + causal ancestors + causal descendants (or the event's anchor span) */
	lineage: ReadonlySet<string>;
	/** all agent spans of the selected session */
	session: ReadonlySet<string>;
	sessionId: string | null;
	/** the selected span's flow (work item and handoffs), see flowOf */
	flow: Flow;
}

const NO_HIGHLIGHT: Highlight = {
	active: false,
	selectedId: null,
	lineage: new Set(),
	session: new Set(),
	sessionId: null,
	flow: NO_FLOW
};

export function computeHighlight(
	index: TraceIndex,
	spanId: string | null,
	eventId: string | null,
	eventAnchorId?: string
): Highlight {
	if (spanId && index.spans.has(spanId)) {
		const lineage = new Set<string>([spanId]);
		for (const a of ancestorsOf(index, spanId)) lineage.add(a.id);
		for (const d of descendantIds(index, spanId)) lineage.add(d);
		const sessionId = sessionIdOf(index, spanId) ?? null;
		const session = new Set((sessionId ? (index.sessionSpans.get(sessionId) ?? []) : []).map((s) => s.id));
		return { active: true, selectedId: spanId, lineage, session, sessionId, flow: flowOf(index, spanId) };
	}
	const ev = eventId ? index.events.get(eventId) : undefined;
	if (ev) {
		const anchor = eventAnchorId ?? ev.spanId;
		const session = new Set((index.sessionSpans.get(ev.sessionId) ?? []).map((s) => s.id));
		return {
			active: true,
			selectedId: null,
			lineage: new Set(anchor ? [anchor] : []),
			session,
			sessionId: ev.sessionId,
			flow: NO_FLOW
		};
	}
	return NO_HIGHLIGHT;
}
