// Pure, deterministic layout: validated trace + view options -> scene in (time, row) units.
// No DOM/Svelte. Pixel geometry is computed by the renderer so zoom/pan never re-runs layout.
import {
	agentTypeOf,
	buildIndex,
	effectiveEndMs,
	type TraceIndex
} from '../model/indexes.js';
import type { WorkTrace, WorkSpan } from '../model/types.js';


export interface LayoutOptions {
	showTools?: boolean;
	showModelCalls?: boolean;
	collapsedSpanIds?: ReadonlySet<string>;
	hiddenAgentTypes?: ReadonlySet<string>;
}

export interface LayoutItem {
	id: string;
	span: WorkSpan;
	/** lane index (0 = top) */
	row: number;
	/** canonical causal depth (parentId only) */
	depth: number;
	/** depth among visible ancestors */
	visibleDepth: number;
	visualParentId?: string;
	startMs: number;
	effectiveEndMs: number;
	agentType?: string;
	/** has causal descendants (anywhere, visible or not) */
	hasChildren: boolean;
	collapsed: boolean;
	/** ref boundaries strictly inside the span (branch switched while running) */
	refTicksMs: number[];
}

/**
 * A rectangle (rows x time) holding one visible subtree that runs in a different worktree than
 * its visual parent (or than the base worktree, for roots). Nothing outside the subtree lies
 * inside it. Regions nest when a subtree switches worktree again. Unknown worktrees get none.
 */
export interface WorktreeRegion {
	worktreeId: string;
	/** visible span whose subtree the region holds */
	rootSpanId: string;
	rowStart: number;
	/** inclusive */
	rowEnd: number;
	startMs: number;
	endMs: number;
	/** nesting depth among regions (0 = outermost) */
	depth: number;
}

export interface PositionedEvent {
	eventId: string;
	anchorSpanId?: string;
	/** true if the anchor came from explicit spanId rather than inference */
	explicitAnchor: boolean;
	position: 'bar' | 'event-strip';
	atMs: number;
	/** overlay end; clipped to the anchor run's end when on a bar (raw duration lives on the event) */
	endMs?: number;
}

interface ResumeEdge {
	fromSpanId: string;
	toSpanId: string;
}

export interface TimelineScene {
	index: TraceIndex;
	items: LayoutItem[];
	itemById: Map<string, LayoutItem>;
	totalRows: number;
	/**
	 * Worktree of the earliest root span (the run's "base" checkout). Renderers may treat it as
	 * the backdrop and only box the other worktrees. Undefined if the root has no worktree.
	 */
	baseWorktreeId?: string;
	/** outermost first, then by start time */
	worktreeRegions: WorktreeRegion[];
	positionedEvents: PositionedEvent[];
	resumeEdges: ResumeEdge[];
	agentTypes: string[];
	startMs: number;
	endMs: number;
}

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function computeLayout(trace: WorkTrace, options: LayoutOptions = {}): TimelineScene {
	const collapsed = options.collapsedSpanIds ?? new Set<string>();
	const hiddenTypes = options.hiddenAgentTypes ?? new Set<string>();
	const index = buildIndex(trace);
	const until = trace.trace.observedUntilMs;
	assertAcyclic(index);

	// Canonical depth via parentId only (resume edges never participate).
	const depthMemo = new Map<string, number>();
	const depthOf = (s: WorkSpan): number => {
		const known = depthMemo.get(s.id);
		if (known !== undefined) return known;
		const parent = s.parentId ? index.spans.get(s.parentId) : undefined;
		const d = parent ? depthOf(parent) + 1 : 0;
		depthMemo.set(s.id, d);
		return d;
	};

	// Visibility: kind/type filters hide a bar but re-attach its descendants visually;
	// collapse hides causal descendants only. Collapse on a filtered-out span is ignored
	// (otherwise its subtree would vanish with no visible marker to expand it).
	const filteredOut = (s: WorkSpan): boolean => {
		if (s.kind === 'tool' && !options.showTools) return true;
		if (s.kind === 'model' && !options.showModelCalls) return true;
		const type = agentTypeOf(index, s);
		return s.kind === 'agent' && type !== undefined && hiddenTypes.has(type);
	};
	const insideCollapsed = (s: WorkSpan): boolean => {
		let p = s.parentId ? index.spans.get(s.parentId) : undefined;
		while (p) {
			if (collapsed.has(p.id) && !filteredOut(p)) return true;
			p = p.parentId ? index.spans.get(p.parentId) : undefined;
		}
		return false;
	};
	const visible = trace.spans.filter((s) => !filteredOut(s) && !insideCollapsed(s));
	const visibleIds = new Set(visible.map((s) => s.id));

	const visualParentOf = (s: WorkSpan): string | undefined => {
		let p = s.parentId ? index.spans.get(s.parentId) : undefined;
		while (p && !visibleIds.has(p.id)) p = p.parentId ? index.spans.get(p.parentId) : undefined;
		return p?.id;
	};
	const visualParent = new Map(visible.map((s) => [s.id, visualParentOf(s)]));
	const visDepthMemo = new Map<string, number>();
	const visibleDepthOf = (id: string): number => {
		const known = visDepthMemo.get(id);
		if (known !== undefined) return known;
		const p = visualParent.get(id);
		const d = p ? visibleDepthOf(p) + 1 : 0;
		visDepthMemo.set(id, d);
		return d;
	};

	const items: LayoutItem[] = visible.map((span) => ({
		id: span.id,
		span,
		row: 0,
		depth: depthOf(span),
		visibleDepth: visibleDepthOf(span.id),
		visualParentId: visualParent.get(span.id),
		startMs: span.startMs,
		effectiveEndMs: effectiveEndMs(span, until),
		agentType: agentTypeOf(index, span),
		hasChildren: (index.children.get(span.id)?.length ?? 0) > 0,
		collapsed: collapsed.has(span.id) && (index.children.get(span.id)?.length ?? 0) > 0,
		refTicksMs: refTicks(index, span, until)
	}));
	items.sort(
		(a, b) => a.startMs - b.startMs || a.visibleDepth - b.visibleDepth || cmpStr(a.id, b.id)
	);
	const itemById = new Map(items.map((i) => [i.id, i]));

	const root = [...trace.spans]
		.filter((sp) => !sp.parentId)
		.sort((a, b) => a.startMs - b.startMs || cmpStr(a.id, b.id))[0];
	const baseWorktreeId = root?.worktreeId;
	const totalRows = pack(items, baseWorktreeId);

	return {
		index,
		items,
		itemById,
		totalRows,
		baseWorktreeId,
		worktreeRegions: worktreeRegions(items, itemById, baseWorktreeId),
		positionedEvents: positionEvents(index, itemById, until),
		resumeEdges: items
			.filter((i) => i.span.kind === 'agent' && i.span.resumesSpanId && itemById.has(i.span.resumesSpanId))
			.map((i) => ({ fromSpanId: (i.span as { resumesSpanId: string }).resumesSpanId, toSpanId: i.id })),
		agentTypes: [...new Set(trace.agentSessions.map((s) => s.agentType))].sort(cmpStr),
		startMs: 0,
		endMs: until
	};
}

interface Occ {
	row: number;
	startMs: number;
	endMs: number;
}

/**
 * Subtree packing over the visible tree (items pre-sorted by start, depth, id).
 *
 * Each visible span's subtree is packed into a block: the span on its own row 0, each child
 * subtree (in start order) at the lowest row offset >= 1 where it collides with nothing already
 * placed. A child subtree that runs in a different worktree than its parent is placed as a solid
 * rectangle (its full time extent across all its rows), and nothing else may enter it. So every
 * worktree switch yields a clean rectangular region that renderers can box, while spans of the
 * same worktree still interlock as tightly as greedy lane packing.
 *
 * A resumed run whose previous run is a sibling reuses that run's row when it and the gap are free.
 * Deterministic; children always sit below their visual parent; no two bars in a row overlap.
 * Assigns `row` on every item and returns the number of rows.
 */
function pack(items: LayoutItem[], baseWorktreeId: string | undefined): number {
	const itemById = new Map(items.map((i) => [i.id, i]));
	const children = new Map<string | undefined, LayoutItem[]>();
	for (const it of items) {
		const list = children.get(it.visualParentId);
		if (list) list.push(it);
		else children.set(it.visualParentId, [it]);
	}
	const relRow = new Map<string, number>();

	const collides = (placed: Occ[], shape: Occ[], offset: number) =>
		shape.some((a) =>
			placed.some((b) => b.row === a.row + offset && a.startMs < b.endMs && b.startMs < a.endMs)
		);

	// Places `kids` under an owner occupying `occ`; returns occupancy including the kids.
	const placeKids = (occ: Occ[], kids: LayoutItem[], ownerWt: string | undefined, minOffset: number) => {
		for (const kid of kids) {
			const b = block(kid);
			const solid = kid.span.worktreeId !== ownerWt;
			const shape: Occ[] = solid
				? Array.from({ length: b.height }, (_, row) => ({ row, startMs: b.startMs, endMs: b.endMs }))
				: b.occ;
			// A resumed run takes its previous run's row when the run and the pause before it are free
			// (both runs siblings here), so the pause reads as one straight, unobstructed line.
			const prevId = kid.span.kind === 'agent' ? kid.span.resumesSpanId : undefined;
			const prevOffset = prevId && kids.some((k) => k.id === prevId) ? relRow.get(prevId) : undefined;
			let offset = minOffset;
			const prev = prevId ? itemById.get(prevId) : undefined;
			const withGap: Occ[] = prev
				? [...shape, { row: 0, startMs: prev.effectiveEndMs, endMs: kid.startMs }]
				: shape;
			if (prevOffset !== undefined && !collides(occ, withGap, prevOffset)) offset = prevOffset;
			else while (collides(occ, shape, offset)) offset++;
			relRow.set(kid.id, offset);
			for (const o of shape) occ.push({ row: o.row + offset, startMs: o.startMs, endMs: o.endMs });
		}
		return occ;
	};

	function block(it: LayoutItem): { occ: Occ[]; height: number; startMs: number; endMs: number } {
		const occ = placeKids(
			[{ row: 0, startMs: it.startMs, endMs: it.effectiveEndMs }],
			children.get(it.id) ?? [],
			it.span.worktreeId,
			1
		);
		return {
			occ,
			height: Math.max(...occ.map((o) => o.row)) + 1,
			startMs: Math.min(...occ.map((o) => o.startMs)),
			endMs: Math.max(...occ.map((o) => o.endMs))
		};
	}

	const top = placeKids([], children.get(undefined) ?? [], baseWorktreeId, 0);
	const rowOf = new Map<string, number>();
	for (const it of items) {
		// items are in start order, so a visual parent is always assigned before its children
		const parentRow = it.visualParentId ? rowOf.get(it.visualParentId)! : 0;
		it.row = parentRow + relRow.get(it.id)!;
		rowOf.set(it.id, it.row);
	}
	return Math.max(1, ...top.map((o) => o.row + 1));
}

function worktreeRegions(
	items: LayoutItem[],
	itemById: Map<string, LayoutItem>,
	baseWorktreeId: string | undefined
): WorktreeRegion[] {
	const kids = new Map<string, LayoutItem[]>();
	for (const it of items) {
		if (!it.visualParentId) continue;
		const list = kids.get(it.visualParentId);
		if (list) list.push(it);
		else kids.set(it.visualParentId, [it]);
	}
	const regions: WorktreeRegion[] = [];
	const visit = (it: LayoutItem, ownerWt: string | undefined, depth: number) => {
		let region: WorktreeRegion | undefined;
		const wt = it.span.worktreeId;
		if (wt !== undefined && wt !== ownerWt) {
			region = { worktreeId: wt, rootSpanId: it.id, rowStart: it.row, rowEnd: it.row, startMs: it.startMs, endMs: it.effectiveEndMs, depth };
			regions.push(region);
		}
		const extent = { rowEnd: it.row, endMs: it.effectiveEndMs };
		for (const k of kids.get(it.id) ?? []) {
			const sub = visit(k, wt, region ? depth + 1 : depth);
			extent.rowEnd = Math.max(extent.rowEnd, sub.rowEnd);
			extent.endMs = Math.max(extent.endMs, sub.endMs);
		}
		if (region) {
			region.rowEnd = extent.rowEnd;
			region.endMs = extent.endMs;
		}
		return extent;
	};
	for (const it of items) if (!it.visualParentId || !itemById.has(it.visualParentId)) visit(it, baseWorktreeId, 0);
	return regions.sort((a, b) => a.depth - b.depth || a.startMs - b.startMs || a.rowStart - b.rowStart);
}

/** Layout trusts validated input, but must never hang on a parent cycle. */
function assertAcyclic(index: TraceIndex): void {
	const done = new Set<string>();
	for (const start of index.spans.values()) {
		const path = new Set<string>();
		let s: WorkSpan | undefined = start;
		while (s && !done.has(s.id)) {
			if (path.has(s.id)) throw new Error(`work-trace: parent cycle at span "${s.id}"; validate the trace first`);
			path.add(s.id);
			s = s.parentId ? index.spans.get(s.parentId) : undefined;
		}
		for (const id of path) done.add(id);
	}
}

function refTicks(index: TraceIndex, span: WorkSpan, until: number): number[] {
	if (!span.worktreeId) return [];
	const end = effectiveEndMs(span, until);
	const ticks = new Set<number>();
	for (const r of index.worktreeRefs.get(span.worktreeId) ?? []) {
		for (const t of [r.startMs, r.endMs]) if (t > span.startMs && t < end) ticks.add(t);
	}
	return [...ticks].sort((a, b) => a - b);
}

/**
 * The single run of the session active at `atMs`. Runs are half-open [start, end) so a
 * back-to-back resume wins at the boundary; the closing instant of a run counts only if no
 * run starts there. If the event has a duration it must fit inside that run, otherwise
 * the event is not attributable to one run and goes to the event strip.
 */
function inferAnchor(
	runs: WorkSpan[],
	atMs: number,
	endMs: number | undefined,
	until: number
): string | undefined {
	let active = runs.filter((s) => s.startMs <= atMs && atMs < effectiveEndMs(s, until));
	if (active.length === 0) active = runs.filter((s) => effectiveEndMs(s, until) === atMs);
	if (active.length !== 1) return undefined;
	const run = active[0];
	if (endMs !== undefined && endMs > effectiveEndMs(run, until)) return undefined;
	return run.id;
}

function positionEvents(
	index: TraceIndex,
	itemById: Map<string, LayoutItem>,
	until: number
): PositionedEvent[] {
	return [...index.trace.events].sort((a, b) => a.atMs - b.atMs || cmpStr(a.id, b.id)).map((e) => {
		let anchor = e.spanId;
		const explicitAnchor = anchor !== undefined;
		if (!anchor) anchor = inferAnchor(index.sessionSpans.get(e.sessionId) ?? [], e.atMs, e.endMs, until);
		const anchorItem = anchor !== undefined ? itemById.get(anchor) : undefined;
		const onBar = anchorItem !== undefined;
		return {
			eventId: e.id,
			anchorSpanId: anchor,
			explicitAnchor,
			position: onBar ? 'bar' : 'event-strip',
			atMs: e.atMs,
			// Overlay end: never drawn past the end of the run it sits on.
			endMs: e.endMs === undefined || !anchorItem ? e.endMs : Math.min(e.endMs, anchorItem.effectiveEndMs)
		};
	});
}
