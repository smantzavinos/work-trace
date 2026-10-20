// Layout invariant check (no test framework): `pnpm check:layout`, also run by `pnpm check`.
// Checks the bundled sample under several option sets, then fuzzes random span trees (with
// worktree switches and resumed sessions). Exits non-zero on any violation.
import { readFileSync } from 'node:fs';
import { computeLayout, flowPredecessors, type LayoutOptions, type TimelineScene } from '../src/lib/layout/compute-layout.ts';
import { regionRects, rowGeom, rowMap } from '../src/lib/layout/geometry.ts';
import type { WorkTrace } from '../src/lib/model/types.ts';
import { validateTrace } from '../src/lib/model/validate.ts';

/** Every violated invariant of a scene, as short messages. */
function violations(sc: TimelineScene, trace: WorkTrace, opts: LayoutOptions): string[] {
	const bad: string[] = [];
	const items = sc.items;

	// 1. Bars in one row never overlap.
	const byRow = new Map<number, typeof items>();
	for (const i of items) byRow.set(i.row, [...(byRow.get(i.row) ?? []), i]);
	for (const list of byRow.values()) {
		list.sort((a, b) => a.startMs - b.startMs);
		for (let k = 1; k < list.length; k++)
			if (list[k].startMs < list[k - 1].effectiveEndMs) bad.push(`overlap ${list[k - 1].id}/${list[k].id}`);
	}

	// 2. Children sit below their visual parent.
	for (const i of items) {
		const p = i.visualParentId ? sc.itemById.get(i.visualParentId) : undefined;
		if (p && i.row <= p.row) bad.push(`child ${i.id} not below parent ${p.id}`);
	}

	// 3. A worktree switch's subtree is a solid rectangle: no outsider bar inside it.
	const kids = new Map<string, string[]>();
	for (const i of items) if (i.visualParentId) kids.set(i.visualParentId, [...(kids.get(i.visualParentId) ?? []), i.id]);
	const subtree = (id: string): string[] => [id, ...(kids.get(id) ?? []).flatMap(subtree)];
	/** solid blocks: subtrees whose root changes worktree (incl. to/from none), as packed */
	const solids: { ids: Set<string>; r0: number; r1: number; t0: number; t1: number }[] = [];
	for (const i of items) {
		const p = i.visualParentId ? sc.itemById.get(i.visualParentId) : undefined;
		const ownerWt = p ? p.span.worktreeId : sc.baseWorktreeId;
		if (i.span.worktreeId === ownerWt) continue;
		const members = subtree(i.id).map((id) => sc.itemById.get(id)!);
		const ids = new Set(members.map((m) => m.id));
		const r0 = Math.min(...members.map((m) => m.row));
		const r1 = Math.max(...members.map((m) => m.row));
		const t0 = Math.min(...members.map((m) => m.startMs));
		const t1 = Math.max(...members.map((m) => m.effectiveEndMs));
		solids.push({ ids, r0, r1, t0, t1 });
		for (const o of items)
			if (!ids.has(o.id) && o.row >= r0 && o.row <= r1 && o.startMs < t1 && t0 < o.effectiveEndMs)
				bad.push(`intruder ${o.id} in worktree box of ${i.id}`);
	}

	// 4. Row continuity. A bar takes its flow predecessor's row (link source or previous work item
	//    step), else its resumed run's row, whenever that row is free over the gap and the bar.
	//    Free means: no other bar, no solid worktree block it isn't part of, and no gap still
	//    reserved for a later flow step. Checked for sibling bars without visible children: with
	//    children, the whole subtree must fit below too, which this check can't judge independently.
	const flowPred = flowPredecessors(
		items,
		sc.workItems,
		sc.handoffs.filter((h) => !h.implicit).map((h) => ({ from: h.fromSpanId, to: h.toSpanId }))
	);
	const order = new Map(items.map((i, k) => [i.id, k]));
	const pendingGaps = [...flowPred].map(([m, p]) => {
		const mi = sc.itemById.get(m)!;
		const pi = sc.itemById.get(p)!;
		const t1 = Math.max(...subtree(m).map((id) => sc.itemById.get(id)!.effectiveEndMs));
		return { m, p, row: pi.row, t0: pi.effectiveEndMs, t1, parent: mi.visualParentId };
	});
	const rowFree = (a: (typeof items)[number], b: (typeof items)[number]) => {
		const over = (s: number, e: number) => s < b.effectiveEndMs && a.effectiveEndMs < e;
		if ((byRow.get(a.row) ?? []).some((o) => o.id !== a.id && o.id !== b.id && over(o.startMs, o.effectiveEndMs))) return false;
		if (solids.some((x) => x.r0 <= a.row && a.row <= x.r1 && over(x.t0, x.t1) && !x.ids.has(b.id))) return false;
		// a later step's reservation, created when its predecessor was placed before b
		return !pendingGaps.some(
			(g) => g.m !== b.id && g.parent === b.visualParentId && g.row === a.row && order.get(g.p)! < order.get(b.id)! &&
				order.get(g.m)! > order.get(b.id)! && over(g.t0, g.t1)
		);
	};
	for (const b of items) {
		if (kids.has(b.id)) continue;
		const resumed = b.span.kind === 'agent' ? b.span.resumesSpanId : undefined;
		for (const prevId of [flowPred.get(b.id), resumed]) {
			const a = prevId ? sc.itemById.get(prevId) : undefined;
			if (!a || a.visualParentId !== b.visualParentId) continue;
			if (rowFree(a, b)) {
				if (b.row !== a.row) bad.push(`${b.id} left the free row of ${a.id}`);
				break;
			}
		}
	}

	// 7. Work item bands hold only their own steps, all on the band's row.
	for (const band of sc.workItemBands) {
		for (const id of band.stepIds) if (sc.itemById.get(id)!.row !== band.row) bad.push(`band step ${id} off its row`);
		for (const o of byRow.get(band.row) ?? [])
			if (!band.stepIds.includes(o.id) && o.startMs < band.endMs && band.startMs < o.effectiveEndMs)
				bad.push(`intruder ${o.id} in band of ${band.workItemId}`);
	}

	// 5. Deterministic regardless of input order.
	const shuffled = structuredClone(trace);
	shuffled.spans.reverse();
	shuffled.events.reverse();
	shuffled.links?.reverse();
	const sig = (s: TimelineScene) =>
		JSON.stringify(s.items.map((i) => [i.id, i.row]).sort()) + JSON.stringify(s.positionedEvents) +
		JSON.stringify(s.workItemBands) + JSON.stringify([...s.handoffs].sort((a, b) => (a.fromSpanId + a.toSpanId < b.fromSpanId + b.toSpanId ? -1 : 1)));
	if (sig(sc) !== sig(computeLayout(shuffled, opts))) bad.push('not deterministic under input shuffle');

	// 6. Pixel rows at every density: strictly increasing, and region boxes contain their bars.
	for (const d of [1, 0.6, 0.15]) {
		const rm = rowMap(sc, true, rowGeom(d));
		for (let r = 1; r < rm.y.length; r++)
			if (!(rm.y[r] >= rm.y[r - 1] + rm.g.barH)) bad.push(`rows ${r - 1}/${r} touch at density ${d}`);
		const vp = { left: 0, viewStartMs: 0, pxPerMs: 1 };
		for (const rect of regionRects(sc, rm, vp))
			for (const id of subtree(rect.region.rootSpanId)) {
				const m = sc.itemById.get(id)!;
				const y = rm.y[m.row];
				if (y < rect.y1 || y + rm.g.barH > rect.y2) bad.push(`bar ${id} outside its box at density ${d}`);
			}
	}
	return bad;
}

let failures = 0;
function report(name: string, bad: string[]) {
	if (!bad.length) return;
	failures++;
	if (failures <= 5) console.error(`✗ ${name}: ${[...new Set(bad)].slice(0, 6).join('; ')}`);
}

// ---- the bundled sample, several option sets ----
function loadSample(): WorkTrace {
	const path = new URL('../static/sample-trace.json', import.meta.url);
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(path, 'utf8'));
	} catch (e) {
		console.error(`check:layout: cannot read ${path.pathname}: ${e instanceof Error ? e.message : String(e)}`);
		process.exit(1);
	}
	const r = validateTrace(raw);
	if (!r.ok || !r.value) {
		console.error(`check:layout: sample trace is invalid: ${JSON.stringify(r).slice(0, 400)}`);
		process.exit(1);
	}
	return r.value;
}
const sample = loadSample();
const sampleOpts: [string, LayoutOptions][] = [
	['default', {}],
	['tools+models', { showTools: true, showModelCalls: true }],
	['collapsed', { collapsedSpanIds: new Set(['research-a-1', 'backend-1']) }],
	['hidden type', { hiddenAgentTypes: new Set(['researcher']) }]
];
for (const [name, opts] of sampleOpts) report(`sample/${name}`, violations(computeLayout(sample, opts), sample, opts));

// ---- fuzz: random trees with worktree switches and resumed sessions ----
let seed = 1;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const RUNS = 2000;
for (let n = 0; n < RUNS; n++) {
	const wts = ['w0', 'w1', 'w2', 'w3'];
	const spans: WorkTrace['spans'] = [];
	const sessions: WorkTrace['agentSessions'] = [];
	const N = 2 + Math.floor(rnd() * 25);
	for (let i = 0; i < N; i++) {
		const parent = i === 0 ? undefined : spans[Math.floor(rnd() * spans.length)];
		const pEnd = parent?.endMs ?? 1000;
		const start = parent ? parent.startMs + Math.floor(rnd() * Math.max(1, pEnd - parent.startMs)) : 0;
		const end = Math.min(1000, parent ? pEnd + 50 : 1000, start + 1 + Math.floor(rnd() * 400));
		const wt = rnd() < 0.6 && parent ? parent.worktreeId : rnd() < 0.15 ? undefined : wts[Math.floor(rnd() * 4)];
		sessions.push({ id: `s${i}`, agentType: rnd() < 0.5 ? 'x' : 'y' });
		const run = { id: `a${i}`, kind: 'agent' as const, sessionId: `s${i}`, mode: 'start' as const, parentId: parent?.id, startMs: start, endMs: end, status: 'ok' as const, ...(wt ? { worktreeId: wt } : {}) };
		// Some spans serve one of three work items.
		const wi = rnd() < 0.35 ? `wi${Math.floor(rnd() * 3)}` : undefined;
		spans.push(wi ? { ...run, workItemId: wi } : run);
		// Sometimes the session pauses and resumes later under the same parent.
		if (rnd() < 0.3 && end < 950) {
			const rs = end + 1 + Math.floor(rnd() * 80);
			const re = Math.min(1000, rs + 1 + Math.floor(rnd() * 200));
			spans.push({ ...run, id: `a${i}r`, mode: 'resume', resumesSpanId: run.id, startMs: rs, endMs: re });
		}
	}
	// Some handoff links from an earlier-starting span to a later one.
	const links: { id: string; fromSpanId: string; toSpanId: string }[] = [];
	for (let k = 0; k < spans.length / 4; k++) {
		const [x, y] = [spans[Math.floor(rnd() * spans.length)], spans[Math.floor(rnd() * spans.length)]];
		if (x.id !== y.id) {
			const [from, to] = x.startMs <= y.startMs ? [x, y] : [y, x];
			links.push({ id: `l${k}`, fromSpanId: from.id, toSpanId: to.id });
		}
	}
	const workItems = [0, 1, 2].map((k) => ({ id: `wi${k}`, label: `Work ${k}` }));
	// SAFETY: the generator only emits the fields computeLayout reads, with schema-valid values
	// (unique ids, parents before children, non-overlapping runs per session); the empty
	// repository/worktree tables are allowed because layout never dereferences them.
	const trace = { schemaVersion: 3, trace: { id: 't', observedUntilMs: 1000 }, repositories: [], worktrees: [], worktreeRefs: [], agentSessions: sessions, spans, events: [], workItems, links } as unknown as WorkTrace;
	const opts: LayoutOptions = { collapsedSpanIds: new Set(rnd() < 0.3 ? [`a${Math.floor(rnd() * N)}`] : []) };
	report(`fuzz #${n}`, violations(computeLayout(trace, opts), trace, opts));
}

if (failures) {
	console.error(`check:layout: ${failures} failing case(s)`);
	process.exit(1);
}
console.log(`check:layout: sample (${sampleOpts.length} option sets) and ${RUNS} fuzzed traces OK`);
