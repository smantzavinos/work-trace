<script lang="ts">
	import { barColor, workItemColor } from '../layout/colors.js';
	import type { LayoutItem, TimelineScene } from '../layout/compute-layout.js';
	import {
		GEOM,
		barWidth,
		hasEventStrip,
		rowGeom,
		rowMap,
		timeToX,
		type Viewport
	} from '../layout/geometry.js';
	import { computeLegend } from '../layout/legend.js';
	import { computeHighlight, descendantIds, flowOf, spanLabel } from '../layout/selection.js';
	import { domMeasure, measureText, type Measure } from '../layout/text.js';
	import { formatElapsed } from '../layout/time.js';
	import { formatRef, refAt } from '../model/indexes.js';
	import { worktreeInfoMap } from '../layout/worktrees.js';
	import { SVG_CSS } from './svg-style.js';
	import EventMarker from './EventMarker.svelte';
	import Relationships from './Relationships.svelte';
	import SpanBar from './SpanBar.svelte';
	import SvgLegend from './SvgLegend.svelte';
	import TimeAxis from './TimeAxis.svelte';
	import WorkItemBands from './WorkItemBands.svelte';
	import WorktreeRegions from './WorktreeRegions.svelte';

	interface Props {
		scene: TimelineScene;
		width: number;
		pxPerMs: number;
		viewStartMs: number;
		/** vertical density, 1 = normal; lower = shorter rows and less detail (see rowGeom) */
		density?: number;
		/** chart-relative [top, bottom] px currently scrolled into view; bars far outside are not drawn */
		visibleY?: readonly [number, number];
		selectedSpanId?: string | null;
		selectedEventId?: string | null;
		showConnectors?: boolean;
		/** Draw worktree regions (default true). */
		showWorktrees?: boolean;
		highlightedWorktreeId?: string | null;
		title?: string;
		/** Static export: no roles/focus/handlers, no culling, title header and embedded legend. */
		exportMode?: boolean;
		onWorktreeSelect?: (id: string) => void;
		onSpanSelect?: (id: string) => void;
		onSpanToggle?: (id: string) => void;
		onEventSelect?: (id: string) => void;
		/** zoom to a time range (clicking a cluster of tiny bars) */
		onRangeZoom?: (startMs: number, endMs: number) => void;
	}

	let {
		scene,
		width,
		pxPerMs,
		viewStartMs,
		density = 1,
		visibleY,
		selectedSpanId = null,
		selectedEventId = null,
		showConnectors = true,
		showWorktrees = true,
		highlightedWorktreeId = null,
		title = 'Work execution timeline',
		exportMode = false,
		onWorktreeSelect,
		onSpanSelect,
		onSpanToggle,
		onEventSelect,
		onRangeZoom
	}: Props = $props();

	const uid = $props.id();
	// Exports use a stable, trace-derived prefix so the output is deterministic.
	const idPrefix = $derived(
		exportMode ? `at-${scene.index.trace.trace.id.replace(/[^A-Za-z0-9_-]/g, '_')}` : `at-${uid}`
	);
	const interactive = $derived(!exportMode);
	const worktrees = $derived(worktreeInfoMap(scene.index, scene.baseWorktreeId));
	const rows = $derived(rowMap(scene, showWorktrees, rowGeom(density)));
	// Live view: exact browser text metrics. Export: the font-agnostic estimate.
	const measure: Measure = $derived(exportMode ? measureText : domMeasure);
	const base = $derived(scene.baseWorktreeId ? worktrees.get(scene.baseWorktreeId) : undefined);
	const until = $derived(scene.index.trace.trace.observedUntilMs);

	// Run number of every agent span within its session (only sessions with several runs).
	const runs = $derived.by(() => {
		const m = new Map<string, { index: number; count: number }>();
		for (const list of scene.index.sessionSpans.values())
			if (list.length > 1) list.forEach((s, k) => m.set(s.id, { index: k + 1, count: list.length }));
		return m;
	});
	// Hovering a run of a multi-run session outlines all its runs and strengthens its pause links.
	let hoverSpanId = $state<string | null>(null);
	const hoverSessionId = $derived.by(() => {
		if (!hoverSpanId || !runs.has(hoverSpanId)) return undefined;
		const s = scene.index.spans.get(hoverSpanId);
		return s?.kind === 'agent' ? s.sessionId : undefined;
	});
	const inHoverSession = (item: LayoutItem) =>
		!!hoverSessionId && item.span.kind === 'agent' && item.span.sessionId === hoverSessionId;

	// Work items: step numbers (items with several steps) and the flow under the pointer.
	const steps = $derived.by(() => {
		const ids = scene.workItems.map((w) => w.workItemId);
		const m = new Map<string, { index: number; count: number; color: string }>();
		for (const w of scene.workItems)
			if (w.stepIds.length > 1) {
				const color = workItemColor(ids, w.workItemId);
				w.stepIds.forEach((id, k) => m.set(id, { index: k + 1, count: w.stepIds.length, color }));
			}
		return m;
	});
	const hoverFlow = $derived(flowOf(scene.index, hoverSpanId));

	// Transient pointer hover over a region/chip: highlights like a click, without selecting.
	let hoverWtId = $state<string | null>(null);
	const hlWt = $derived(highlightedWorktreeId ?? (showWorktrees ? hoverWtId : null));

	const legend = $derived(exportMode ? computeLegend(scene, width, showWorktrees) : { items: [], titles: [], height: 0 });
	const metaLine = $derived.by(() => {
		const total = scene.index.spans.size;
		const parts = [
			scene.items.length < total ? `${scene.items.length} of ${total} spans` : `${total} spans`,
			`${scene.index.sessions.size} sessions`,
			`${formatElapsed(until, 1000)} observed`
		];
		if (showWorktrees && base) {
			const root = scene.items.find((i) => !i.visualParentId);
			const ref = root ? formatRef(refAt(scene.index, base.id, root.startMs)) : 'Unknown';
			parts.push(`base: ${base.label}${ref === 'Unknown' ? '' : ' · ' + ref}`);
		}
		return parts.join('  ·  ');
	});
	const desc = $derived(
		`Execution timeline: ${scene.items.length} spans, ` +
			`${scene.agentTypes.length} agent types, ${scene.positionedEvents.length} events` +
			`${scene.worktreeRegions.length && showWorktrees ? `, ${scene.worktreeRegions.length} worktree regions` : ''}; ` +
			`time 0–${(scene.endMs / 1000).toFixed(1)}s.`
	);

	const vp: Viewport = $derived({ left: GEOM.left, viewStartMs, pxPerMs });
	const strip = $derived(hasEventStrip(scene));
	const headerH = $derived(exportMode ? 58 : 0);
	const chartHeight = $derived(rows.height);
	const height = $derived(headerH + chartHeight + legend.height);

	const eventAnchor = $derived(
		selectedEventId
			? scene.positionedEvents.find((e) => e.eventId === selectedEventId)?.anchorSpanId
			: undefined
	);
	const highlight = $derived(
		computeHighlight(scene.index, selectedSpanId, selectedEventId, eventAnchor)
	);
	const flowSpanIds = $derived(new Set([...highlight.flow.spanIds, ...hoverFlow.spanIds]));
	const flowWorkItems = $derived(new Set([...highlight.flow.workItemIds, ...hoverFlow.workItemIds]));
	/** bar outline colour for members of a focused flow (its steps and linked spans) */
	function flowOutline(item: LayoutItem): string | undefined {
		if (!flowSpanIds.has(item.id)) return undefined;
		const w = item.span.workItemId;
		return w !== undefined && flowWorkItems.has(w) ? workItemColor(scene.workItems.map((x) => x.workItemId), w) : '#1f2430';
	}

	// For each bar: the time before which its label may spill to the right (next bar in the
	// same row, the end of its enclosing worktree region, or the start of a region that begins
	// to its right in the same rows) and how many extra px to keep clear for a region border.
	// Depends on the scene only, so zoom/pan never recompute it.
	const labelLimit = $derived.by(() => {
		const byRow = new Map<number, LayoutItem[]>();
		for (const i of scene.items) {
			const list = byRow.get(i.row);
			if (list) list.push(i);
			else byRow.set(i.row, [i]);
		}
		const limit = new Map<string, { ms: number; extra: number }>();
		const tighten = (id: string, ms: number, extra: number) => {
			const cur = limit.get(id);
			if (!cur || ms < cur.ms) limit.set(id, { ms, extra });
		};
		for (const list of byRow.values()) {
			list.sort((a, b) => a.startMs - b.startMs);
			list.forEach((it, k) => {
				if (list[k + 1]) tighten(it.id, list[k + 1].startMs, 0);
			});
		}
		if (showWorktrees)
			for (const it of scene.items)
				for (const r of scene.worktreeRegions) {
					if (it.row < r.rowStart || it.row > r.rowEnd) continue;
					if (it.startMs >= r.startMs && it.startMs <= r.endMs) tighten(it.id, r.endMs, 0);
					else if (r.startMs >= it.effectiveEndMs) tighten(it.id, r.startMs, 14);
				}
		return limit;
	});
	function roomRight(item: LayoutItem): number {
		const lim = labelLimit.get(item.id);
		const limitX = lim === undefined ? width - 6 : timeToX(vp, lim.ms) - lim.extra;
		return limitX - (timeToX(vp, item.startMs) + barWidth(vp, item.startMs, item.effectiveEndMs)) - 12;
	}

	function isDimmed(item: LayoutItem): boolean {
		return highlight.active
			? !highlight.lineage.has(item.id) && !highlight.session.has(item.id) && !highlight.flow.members.has(item.id)
			: !!hlWt && item.span.worktreeId !== hlWt;
	}

	// Horizontal culling only; layout is untouched by zoom/pan.
	const inView = (startMs: number, endMs: number) => {
		const x1 = timeToX(vp, startMs);
		const x2 = x1 + barWidth(vp, startMs, endMs);
		return x2 >= -24 && x1 <= width + 24;
	};
	// Vertical culling (live view): rows more than a screen away from the scrolled area are skipped.
	const inRows = (row: number) => {
		if (!visibleY) return true;
		const y = rows.y[row];
		const margin = Math.max(200, visibleY[1] - visibleY[0]);
		return y + rows.g.barH >= visibleY[0] - margin && y <= visibleY[1] + margin;
	};
	const visible = $derived(
		exportMode
			? scene.items
			: scene.items.filter(
					(i) => i.id === selectedSpanId || (inView(i.startMs, i.effectiveEndMs) && inRows(i.row))
				)
	);

	// Runs of 3+ bars in one row that are each under TINY px and at most GAP px apart are drawn as one
	// cluster strip: thousands of sub-pixel tool calls are unreadable one by one and cost a DOM
	// node group each. Selected / highlighted bars always stay individual.
	const TINY = 6;
	const GAP = 4;
	interface Cluster {
		key: string;
		row: number;
		startMs: number;
		endMs: number;
		members: LayoutItem[];
	}
	const drawn = $derived.by(() => {
		const keep = (i: LayoutItem) =>
			i.id === selectedSpanId ||
			highlight.lineage.has(i.id) ||
			highlight.session.has(i.id) ||
			inHoverSession(i) ||
			steps.has(i.id) ||
			flowSpanIds.has(i.id);
		const byRow = new Map<number, LayoutItem[]>();
		for (const i of visible) byRow.set(i.row, [...(byRow.get(i.row) ?? []), i]);
		const singles: LayoutItem[] = [];
		const clusters: Cluster[] = [];
		for (const [row, list] of byRow) {
			list.sort((a, b) => a.startMs - b.startMs);
			let run: LayoutItem[] = [];
			const flush = () => {
				if (run.length >= 3)
					clusters.push({ key: `${row}:${run[0].id}`, row, startMs: run[0].startMs, endMs: Math.max(...run.map((m) => m.effectiveEndMs)), members: run });
				else singles.push(...run);
				run = [];
			};
			for (const i of list) {
				const tiny = (i.effectiveEndMs - i.startMs) * pxPerMs < TINY && !keep(i);
				if (!tiny) {
					flush();
					singles.push(i);
					continue;
				}
				const last = run[run.length - 1];
				if (last && (i.startMs - last.effectiveEndMs) * pxPerMs > GAP) flush();
				run.push(i);
			}
			flush();
		}
		// Original (start) order keeps the paint order stable.
		const order = new Map(scene.items.map((i, k) => [i.id, k]));
		singles.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
		return { singles, clusters };
	});
	const bars = $derived(drawn.singles);
	function clusterTitle(c: Cluster): string {
		const kinds = new Map<string, number>();
		for (const m of c.members) kinds.set(m.span.kind, (kinds.get(m.span.kind) ?? 0) + 1);
		const parts = [...kinds].map(([k, n]) => `${n} ${k === 'model' ? 'model call' : k}${n > 1 ? 's' : ''}`);
		return `${parts.join(', ')} · ${formatElapsed(c.startMs, 1000)}–${formatElapsed(c.endMs, 1000)}${interactive ? ' · click to zoom in' : ''}`;
	}
	const events = $derived(
		scene.positionedEvents.filter((p) => {
			if (exportMode) return true;
			const x = timeToX(vp, p.atMs);
			const x2 = p.endMs === undefined ? x : timeToX(vp, p.endMs);
			return x2 >= -24 && x <= width + 24;
		})
	);
	const stripY = GEOM.rulerH + GEOM.stripH / 2;
	// "Unattached events" caption: left, else right-aligned, else omitted if markers sit there.
	const stripLabelW = measureText('Unattached events', 10.5);
	const stripLabel = $derived.by(() => {
		if (!strip) return undefined;
		const xs = scene.positionedEvents
			.filter((p) => p.position === 'event-strip')
			.flatMap((p) => [timeToX(vp, p.atMs), p.endMs === undefined ? timeToX(vp, p.atMs) : timeToX(vp, p.endMs)]);
		const clear = (a: number, b: number) => !xs.some((x) => x >= a - 12 && x <= b + 12);
		if (clear(8, 8 + stripLabelW)) return { x: 8, anchor: 'start' as const };
		const rx = width - 10;
		if (clear(rx - stripLabelW, rx)) return { x: rx, anchor: 'end' as const };
		return undefined;
	});

	function select(id: string) {
		onWorktreeSelect?.(id);
	}
</script>

<svg
	class="at-root"
	xmlns="http://www.w3.org/2000/svg"
	{width}
	{height}
	viewBox="0 0 {width} {height}"
	role={exportMode ? 'img' : 'group'}
	aria-label={title}
>
	<title>{title}</title>
	<desc>{desc}</desc>
	<!-- svelte:element: a literal <style> child is treated as raw text by Svelte -->
	<svelte:element this={'style'}>{SVG_CSS}</svelte:element>
	<defs>
		<pattern id="{idPrefix}-hatch-l" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
			<line x1="0" y1="0" x2="0" y2="6" stroke="#ffffff" stroke-opacity="0.24" stroke-width="2" />
		</pattern>
		<pattern id="{idPrefix}-hatch-d" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
			<line x1="0" y1="0" x2="0" y2="6" stroke="#1f2430" stroke-opacity="0.12" stroke-width="2.2" />
		</pattern>
		<!-- cluster strips: fine vertical ticks read as "many small calls" -->
		<pattern id="{idPrefix}-dense" width="3" height="4" patternUnits="userSpaceOnUse">
			<line x1="1.5" y1="0" x2="1.5" y2="4" stroke="#1f2430" stroke-opacity="0.18" stroke-width="1" />
		</pattern>
	</defs>

	<rect class="at-bg" data-bg="true" x="0" y="0" {width} {height} fill="#ffffff" />

	{#if exportMode}
		<text class="at-doc-title" x="16" y="26">{title}</text>
		<text class="at-doc-meta" x="16" y="44">{metaLine}</text>
	{/if}

	<g transform="translate(0 {headerH})">
		<TimeAxis {vp} {width} height={chartHeight} observedUntilMs={until} />

		{#if strip}
			<g class="at-event-strip" pointer-events="none">
				<rect x="0" y={GEOM.rulerH} {width} height={GEOM.stripH} fill="#f8f9fb" />
				<line x1="0" x2={width} y1={GEOM.rulerH + GEOM.stripH - 0.5} y2={GEOM.rulerH + GEOM.stripH - 0.5} stroke="#e6e8ec" />
				{#if stripLabel}
					<text class="at-small" x={stripLabel.x} text-anchor={stripLabel.anchor} y={GEOM.rulerH + GEOM.stripH / 2 + 3.5}>Unattached events</text>
				{/if}
			</g>
		{/if}

		{#if showWorktrees}
			<WorktreeRegions
				{scene}
				{vp}
				{width}
				{rows}
				{worktrees}
				{measure}
				highlightedWorktreeId={hlWt}
				layer="body"
				{interactive}
				onSelect={select}
				onHover={(id) => (hoverWtId = id)}
			/>
		{/if}

		{#if scene.workItemBands.length}
			<WorkItemBands
				{scene}
				{vp}
				{width}
				{rows}
				{measure}
				focused={flowWorkItems}
				faded={highlight.active && !highlight.flow.workItemIds.size}
			/>
		{/if}

		<Relationships {scene} {vp} {width} ys={rows.y} g={rows.g} {measure} {highlight} {showConnectors} {hoverSessionId} {flowSpanIds} {idPrefix} />

		{#each bars as item (item.id)}
			<SpanBar
				{item}
				label={spanLabel(scene.index, item.span)}
				{vp}
				y={rows.y[item.row]}
				g={rows.g}
				{measure}
				color={barColor(scene.agentTypes, item.span.kind, item.agentType)}
				{idPrefix}
				selected={item.id === highlight.selectedId}
				sameSession={highlight.session.has(item.id) || inHoverSession(item)}
				run={runs.get(item.id)}
				step={steps.get(item.id)}
				flowOutline={item.id === highlight.selectedId ? undefined : flowOutline(item)}
				dimmed={isDimmed(item)}
				{interactive}
				roomRight={roomRight(item)}
				hiddenCount={item.collapsed ? descendantIds(scene.index, item.id).length : 0}
				onSelect={onSpanSelect}
				onToggle={onSpanToggle}
				onHover={interactive ? (id) => (hoverSpanId = id) : undefined}
			/>
		{/each}

		{#each drawn.clusters as c (c.key)}
			{@const first = c.members[0]}
			{@const col = barColor(scene.agentTypes, first.span.kind, first.agentType)}
			{@const cx = timeToX(vp, c.startMs)}
			{@const cw = Math.max(GEOM.minBarW, (c.endMs - c.startMs) * pxPerMs)}
			<!-- svelte-ignore a11y_click_events_have_key_events (keyboard users zoom with +/−) -->
			<g
				class="at-cluster"
				data-cluster-size={c.members.length}
				opacity={c.members.every(isDimmed) ? 0.25 : 1}
				role="presentation"
				onclick={interactive ? () => onRangeZoom?.(c.startMs, c.endMs) : undefined}
			>
				<title>{clusterTitle(c)}</title>
				<rect x={cx} y={rows.y[c.row]} width={cw} height={rows.g.barH} rx={Math.min(rows.g.radius, cw / 2)} fill={col.fill} stroke={col.border ?? 'none'} />
				<rect x={cx} y={rows.y[c.row]} width={cw} height={rows.g.barH} fill="url(#{idPrefix}-dense)" pointer-events="none" />
			</g>
		{/each}

		{#each events as p (p.eventId)}
			{@const ev = scene.index.events.get(p.eventId)}
			{@const anchor = p.anchorSpanId ? scene.itemById.get(p.anchorSpanId) : undefined}
			{#if ev}
				{#if p.position === 'bar' && anchor}
					<EventMarker
						event={ev}
						positioned={p}
						{vp}
						cy={rows.y[anchor.row] + 1.5}
						overlayY={rows.y[anchor.row]}
						overlayH={rows.g.barH}
						scale={rows.g.density}
						selected={selectedEventId === ev.id}
						dimmed={isDimmed(anchor)}
						{interactive}
						onSelect={onEventSelect}
					/>
				{:else if p.position === 'event-strip'}
					<EventMarker
						event={ev}
						positioned={p}
						{vp}
						cy={stripY}
						overlayY={stripY - 2}
						overlayH={4}
						selected={selectedEventId === ev.id}
						{interactive}
						onSelect={onEventSelect}
					/>
				{/if}
			{/if}
		{/each}

		{#if showWorktrees}
			<WorktreeRegions
				{scene}
				{vp}
				{width}
				{rows}
				{worktrees}
				{measure}
				highlightedWorktreeId={hlWt}
				layer="chip"
				{interactive}
				onSelect={select}
				onHover={(id) => (hoverWtId = id)}
			/>
		{/if}
	</g>

	{#if exportMode}
		<SvgLegend items={legend.items} titles={legend.titles} {width} y={headerH + chartHeight} {idPrefix} />
	{/if}
</svg>
