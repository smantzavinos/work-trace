// Pure selection/lineage helpers over the trace index.
import { ancestorsOf, type TraceIndex } from '../model/indexes.js';
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

export interface Highlight {
	active: boolean;
	selectedId: string | null;
	/** selected + causal ancestors + causal descendants (or the event's anchor span) */
	lineage: ReadonlySet<string>;
	/** all agent spans of the selected session */
	session: ReadonlySet<string>;
	sessionId: string | null;
}

const NO_HIGHLIGHT: Highlight = {
	active: false,
	selectedId: null,
	lineage: new Set(),
	session: new Set(),
	sessionId: null
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
		return { active: true, selectedId: spanId, lineage, session, sessionId };
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
			sessionId: ev.sessionId
		};
	}
	return NO_HIGHLIGHT;
}
