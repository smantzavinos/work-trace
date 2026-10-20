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
 * A rectangle (rows x time) holding the visible subtrees of one or more sibling calls that run in
 * a different worktree than their visual parent (or than the base worktree, for roots).
 * Consecutive same-worktree siblings share one region when nothing else lies between them.
 * Nothing outside the subtrees lies inside it. Regions nest when a subtree switches worktree
 * again. Unknown worktrees get none.
 */
export interface WorktreeRegion {
	worktreeId: string;
	/** first visible span whose subtree the region holds */
	rootSpanId: string;
	/** every visible span whose subtree the region holds, in start order */
	rootSpanIds: string[];
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

/** A work item's visible steps: spans tagged with it that have no visible ancestor in it. */
export interface WorkItemSteps {
	workItemId: string;
	label: string;
	/** start order */
	stepIds: string[];
}

/**
 * A row segment holding consecutive steps of one work item and nothing else between them,
 * drawn as a band behind the bars. A work item split across rows has several bands.
 */
export interface WorkItemBand {
	workItemId: string;
	row: number;
	startMs: number;
	endMs: number;
	stepIds: string[];
	/** first band of its work item (carries the title) */
	first: boolean;
}

/** Handoff arrow between visible bars: an explicit link, or consecutive steps of a work item. */
export interface Handoff {
	fromSpanId: string;
	toSpanId: string;
	/** relation label(s) from the link(s), e.g. "review" */
	kind?: string;
	/** true when inferred from work item step order rather than an explicit link */
	implicit: boolean;
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
	/** work items with at least one visible step, by first step start */
	workItems: WorkItemSteps[];
	workItemBands: WorkItemBand[];
	handoffs: Handoff[];
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

	// Handoff links mapped onto visible bars (a hidden endpoint moves to its nearest visible ancestor).
	const visibleSelfOrAncestor = (id: string): string | undefined => {
		let s = index.spans.get(id);
		while (s && !visibleIds.has(s.id)) s = s.parentId ? index.spans.get(s.parentId) : undefined;
		return s?.id;
	};
	const visLinks: { from: string; to: string; kind?: string }[] = [];
	for (const l of index.links) {
		const from = visibleSelfOrAncestor(l.fromSpanId);
		const to = visibleSelfOrAncestor(l.toSpanId);
		if (from && to && from !== to) visLinks.push({ from, to, kind: l.kind });
	}
	const steps = workItemSteps(index, items, itemById);
	const totalRows = pack(items, baseWorktreeId, flowPredecessors(items, steps, visLinks, baseWorktreeId));

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
		workItems: steps,
		workItemBands: workItemBands(items, itemById, steps),
		handoffs: handoffs(itemById, steps, visLinks),
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
 * Flows keep work readable left to right: a step whose flow predecessor (see `flowPredecessors`) is a
 * sibling takes that predecessor's row when the step and the gap before it are free, and other
 * siblings avoid that gap and step while it is pending (a call in another worktree than its
 * parent counts its previous same-worktree sibling as a flow predecessor, so a worktree's calls
 * line up into one region). Failing that, a resumed run whose previous
 * run is a sibling reuses that run's row when it and the pause are free.
 * Deterministic; children always sit below their visual parent; no two bars in a row overlap.
 * Assigns `row` on every item and returns the number of rows.
 */
function pack(items: LayoutItem[], baseWorktreeId: string | undefined, flowPred: Map<string, string>): number {
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
		// cached per sibling group: a flow successor's shape is needed for its reservation and placement
		const shapes = new Map<string, Occ[]>();
		const shapeOf = (kid: LayoutItem): Occ[] => {
			const known = shapes.get(kid.id);
			if (known) return known;
			const b = block(kid);
			const shape =
				kid.span.worktreeId !== ownerWt
					? Array.from({ length: b.height }, (_, row) => ({ row, startMs: b.startMs, endMs: b.endMs }))
					: b.occ;
			shapes.set(kid.id, shape);
			return shape;
		};
		const kidIds = new Set(kids.map((k) => k.id));
		// pending flow steps: successor id -> its predecessor's gap and its own shape, on the predecessor's row
		const reserved = new Map<string, Occ[]>();
		const successors = new Map<string, LayoutItem[]>();
		for (const kid of kids) {
			const pred = flowPred.get(kid.id);
			if (pred && kidIds.has(pred)) successors.set(pred, [...(successors.get(pred) ?? []), kid]);
		}
		const othersReserved = (id: string): Occ[] =>
			[...reserved].flatMap(([owner, r]) => (owner === id ? [] : r));
		/** `prevId`'s row, if `kid` (with the gap since `prevId` ended) fits there. */
		const sameRowAs = (kid: LayoutItem, shape: Occ[], blockers: Occ[], prevId: string | undefined) => {
			const prevOffset = prevId && kidIds.has(prevId) ? relRow.get(prevId) : undefined;
			const prev = prevId ? itemById.get(prevId) : undefined;
			if (prevOffset === undefined || !prev) return undefined;
			const withGap = [...shape, { row: 0, startMs: prev.effectiveEndMs, endMs: kid.startMs }];
			return collides(blockers, withGap, prevOffset) ? undefined : prevOffset;
		};
		for (const kid of kids) {
			const shape = shapeOf(kid);
			const blockers = reserved.size ? [...occ, ...othersReserved(kid.id)] : occ;
			// A flow step takes its predecessor's row; else a resumed run takes its previous run's row
			// (so the pause reads as one straight, unobstructed line); else the lowest free row.
			const resumed = kid.span.kind === 'agent' ? kid.span.resumesSpanId : undefined;
			let offset =
				sameRowAs(kid, shape, blockers, flowPred.get(kid.id)) ?? sameRowAs(kid, shape, blockers, resumed);
			if (offset === undefined) {
				offset = minOffset;
				while (collides(blockers, shape, offset)) offset++;
			}
			relRow.set(kid.id, offset);
			reserved.delete(kid.id);
			for (const o of shape) occ.push({ row: o.row + offset, startMs: o.startMs, endMs: o.endMs });
			for (const next of successors.get(kid.id) ?? []) {
				reserved.set(next.id, [
					{ row: offset, startMs: kid.effectiveEndMs, endMs: next.startMs },
					...shapeOf(next).map((o) => ({ row: o.row + offset, startMs: o.startMs, endMs: o.endMs }))
				]);
			}
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

/** Visible steps of each work item: tagged spans with no visible ancestor tagged the same. */
function workItemSteps(index: TraceIndex, items: LayoutItem[], itemById: Map<string, LayoutItem>): WorkItemSteps[] {
	const out: WorkItemSteps[] = [];
	for (const [workItemId, w] of index.workItems) {
		const stepIds = items
			.filter((it) => {
				if (it.span.workItemId !== workItemId) return false;
				for (let p = it.visualParentId; p; p = itemById.get(p)?.visualParentId)
					if (itemById.get(p)?.span.workItemId === workItemId) return false;
				return true;
			})
			.map((it) => it.id);
		if (stepIds.length) out.push({ workItemId, label: w.label, stepIds });
	}
	const first = (w: WorkItemSteps) => itemById.get(w.stepIds[0])!;
	return out.sort((a, b) => first(a).startMs - first(b).startMs || cmpStr(a.workItemId, b.workItemId));
}

/**
 * Flow predecessor of each visible bar, among its visible siblings: a link source in its own work
 * item, else any link source, else the previous step of its work item, else (for a bar in another
 * worktree than its visual parent) the previous sibling in the same worktree; within each tier,
 * the candidate that ended last before it started.
 * Bars that overlap their candidates have none (parallel work cannot share a row).
 */
export function flowPredecessors(
	items: LayoutItem[],
	steps: WorkItemSteps[],
	visLinks: { from: string; to: string }[],
	baseWorktreeId: string | undefined
): Map<string, string> {
	const byId = new Map(items.map((i) => [i.id, i]));
	const pred = new Map<string, string>();
	const latestBefore = (it: LayoutItem, ids: Iterable<string>) => {
		let best: LayoutItem | undefined;
		for (const id of ids) {
			const c = byId.get(id);
			if (!c || c.id === it.id || c.visualParentId !== it.visualParentId || c.effectiveEndMs > it.startMs) continue;
			if (!best || c.effectiveEndMs > best.effectiveEndMs || (c.effectiveEndMs === best.effectiveEndMs && cmpStr(c.id, best.id) > 0))
				best = c;
		}
		return best?.id;
	};
	const linkedFrom = new Map<string, string[]>();
	for (const l of visLinks) linkedFrom.set(l.to, [...(linkedFrom.get(l.to) ?? []), l.from]);
	const stepsOf = new Map<string, string[]>();
	for (const w of steps) for (const id of w.stepIds) stepsOf.set(id, w.stepIds);
	// worktree switches grouped by parent and worktree
	const switchKey = (it: LayoutItem) => {
		const wt = it.span.worktreeId;
		const ownerWt = it.visualParentId ? byId.get(it.visualParentId)?.span.worktreeId : baseWorktreeId;
		return wt !== undefined && wt !== ownerWt ? `${it.visualParentId ?? ''}\u0000${wt}` : undefined;
	};
	const switches = new Map<string, string[]>();
	for (const it of items) {
		const k = switchKey(it);
		if (!k) continue;
		const list = switches.get(k);
		if (list) list.push(it.id);
		else switches.set(k, [it.id]);
	}
	for (const it of items) {
		const linked = linkedFrom.get(it.id) ?? [];
		const sameItem = stepsOf.get(it.id) ?? [];
		const k = switchKey(it);
		const p =
			latestBefore(it, linked.filter((id) => sameItem.includes(id))) ??
			latestBefore(it, linked) ??
			latestBefore(it, sameItem) ??
			(k ? latestBefore(it, switches.get(k)!) : undefined);
		if (p) pred.set(it.id, p);
	}
	return pred;
}

/** Row segments of consecutive steps with nothing else between them on that row. */
function workItemBands(items: LayoutItem[], itemById: Map<string, LayoutItem>, steps: WorkItemSteps[]): WorkItemBand[] {
	if (!steps.length) return [];
	const byRow = new Map<number, LayoutItem[]>();
	for (const it of items) {
		const list = byRow.get(it.row);
		if (list) list.push(it);
		else byRow.set(it.row, [it]);
	}
	const bands: WorkItemBand[] = [];
	for (const w of steps) {
		const open = new Map<number, WorkItemBand>();
		let first = true;
		for (const id of w.stepIds) {
			const it = itemById.get(id)!;
			const band = open.get(it.row);
			const clear =
				band !== undefined &&
				!(byRow.get(it.row) ?? []).some(
					(o) => !band.stepIds.includes(o.id) && o.id !== id && o.startMs < it.startMs && band.endMs < o.effectiveEndMs
				);
			if (band && clear) {
				band.stepIds.push(id);
				band.endMs = Math.max(band.endMs, it.effectiveEndMs);
			} else {
				const b = { workItemId: w.workItemId, row: it.row, startMs: it.startMs, endMs: it.effectiveEndMs, stepIds: [id], first };
				first = false;
				open.set(it.row, b);
				bands.push(b);
			}
		}
	}
	return bands.sort((a, b) => a.row - b.row || a.startMs - b.startMs);
}

/** Explicit links (deduplicated per bar pair), plus implicit arrows between consecutive steps. */
function handoffs(
	itemById: Map<string, LayoutItem>,
	steps: WorkItemSteps[],
	visLinks: { from: string; to: string; kind?: string }[]
): Handoff[] {
	const out = new Map<string, Handoff>();
	for (const l of visLinks) {
		const key = `${l.from}\u0000${l.to}`;
		const h = out.get(key);
		if (!h) out.set(key, { fromSpanId: l.from, toSpanId: l.to, kind: l.kind, implicit: false });
		else if (l.kind && !(h.kind ?? '').split(', ').includes(l.kind)) h.kind = h.kind ? `${h.kind}, ${l.kind}` : l.kind;
	}
	const linkedInto = new Set(visLinks.map((l) => l.to));
	for (const w of steps) {
		for (let k = 1; k < w.stepIds.length; k++) {
			const to = itemById.get(w.stepIds[k])!;
			if (linkedInto.has(to.id)) continue;
			// the step that ended last before this one started (parallel steps get no arrow)
			const from = w.stepIds
				.slice(0, k)
				.map((id) => itemById.get(id)!)
				.filter((c) => c.effectiveEndMs <= to.startMs)
				.sort((a, b) => b.effectiveEndMs - a.effectiveEndMs || cmpStr(b.id, a.id))[0];
			if (from) out.set(`${from.id}\u0000${to.id}`, { fromSpanId: from.id, toSpanId: to.id, implicit: true });
		}
	}
	return [...out.values()];
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
			region = { worktreeId: wt, rootSpanId: it.id, rootSpanIds: [it.id], rowStart: it.row, rowEnd: it.row, startMs: it.startMs, endMs: it.effectiveEndMs, depth };
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
	return mergeRegions(regions, items, itemById).sort((a, b) => a.depth - b.depth || a.startMs - b.startMs || a.rowStart - b.rowStart);
}

/**
 * Consecutive regions of sibling calls in the same worktree become one region when the rectangle
 * spanning them holds no bar outside their subtrees (like work item bands).
 */
function mergeRegions(regions: WorktreeRegion[], items: LayoutItem[], itemById: Map<string, LayoutItem>): WorktreeRegion[] {
	const groups = new Map<string, WorktreeRegion[]>();
	for (const r of regions) {
		const k = `${itemById.get(r.rootSpanId)!.visualParentId ?? ''}\u0000${r.worktreeId}`;
		const g = groups.get(k);
		if (g) g.push(r);
		else groups.set(k, [r]);
	}
	if ([...groups.values()].every((g) => g.length < 2)) return regions;
	const byRow = new Map<number, LayoutItem[]>();
	for (const it of items) {
		const list = byRow.get(it.row);
		if (list) list.push(it);
		else byRow.set(it.row, [it]);
	}
	const insideAll = (it: LayoutItem, ids: Set<string>) => {
		for (let p: LayoutItem | undefined = it; p; p = p.visualParentId ? itemById.get(p.visualParentId) : undefined)
			if (ids.has(p.id)) return true;
		return false;
	};
	const clean = (r: WorktreeRegion, ids: Set<string>) => {
		for (let row = r.rowStart; row <= r.rowEnd; row++)
			for (const o of byRow.get(row) ?? [])
				if (o.startMs < r.endMs && r.startMs < o.effectiveEndMs && !insideAll(o, ids)) return false;
		return true;
	};
	const out: WorktreeRegion[] = [];
	for (const g of groups.values()) {
		if (g.length < 2) {
			out.push(...g);
			continue;
		}
		g.sort((a, b) => a.startMs - b.startMs || cmpStr(a.rootSpanId, b.rootSpanId));
		// Merge neighbours until stable: a merge can absorb bars that blocked an earlier one.
		for (let k = 0; k < g.length - 1; ) {
			const [cur, r] = [g[k], g[k + 1]];
			const merged: WorktreeRegion = {
				...cur,
				rootSpanIds: [...cur.rootSpanIds, ...r.rootSpanIds],
				rowStart: Math.min(cur.rowStart, r.rowStart),
				rowEnd: Math.max(cur.rowEnd, r.rowEnd),
				startMs: Math.min(cur.startMs, r.startMs),
				endMs: Math.max(cur.endMs, r.endMs)
			};
			if (clean(merged, new Set(merged.rootSpanIds))) {
				g.splice(k, 2, merged);
				k = Math.max(0, k - 1);
			} else k++;
		}
		out.push(...g);
	}
	return out;
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
