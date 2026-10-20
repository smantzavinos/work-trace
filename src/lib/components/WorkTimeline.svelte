<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { exportTimelineSvg } from '../export/export-svg.js';
	import { computeLayout } from '../layout/compute-layout.js';
	import { GEOM, MIN_DENSITY, fitPxPerMs, rowGeom, rowMap } from '../layout/geometry.js';
	import { legendGroups } from '../layout/legend.js';
	import { stepPosition, stepsOnlyCollapse } from '../layout/selection.js';
	import DetailsPanel from './DetailsPanel.svelte';
	import Legend from './Legend.svelte';
	import TimelineSvg from './TimelineSvg.svelte';
	import type { WorkTimelineProps } from './types.js';

	let {
		trace,
		selectedSpanId,
		onSpanSelect,
		onEventSelect,
		showTools = false,
		showModelCalls = false,
		showConnectors = true,
		showWorktrees = true,
		hiddenAgentTypes,
		highlightedWorktreeId,
		onWorktreeSelect
	}: WorkTimelineProps = $props();

	// ---- transient UI state (never written back to the trace) ----
	let collapsed = $state.raw<ReadonlySet<string>>(new Set());
	let internalSpanId = $state<string | null>(null);
	let selectedEventId = $state<string | null>(null);
	/** null = fit all (follows container width) */
	let userView = $state<{ viewStartMs: number; pxPerMs: number } | null>(null);
	/** vertical density: zooming out past "fit" shrinks rows instead of time (1 = normal) */
	let density = $state(1);
	let width = $state(0);
	let scrollEl = $state<HTMLDivElement>();
	/** chart-relative [top, bottom] px in view, for vertical culling (rAF-throttled) */
	let visibleY = $state<readonly [number, number]>([0, 800]);
	let scrollRaf = 0;
	function trackScroll() {
		if (scrollRaf || !scrollEl) return;
		scrollRaf = requestAnimationFrame(() => {
			scrollRaf = 0;
			if (scrollEl) visibleY = [scrollEl.scrollTop, scrollEl.scrollTop + scrollEl.clientHeight];
		});
	}
	let panning = $state(false);
	let internalWtId = $state<string | null>(null);

	// Layout depends only on trace/filters/collapse. Zoom and pan never reach it.
	const scene = $derived(
		computeLayout(trace, {
			showTools,
			showModelCalls,
			collapsedSpanIds: collapsed,
			hiddenAgentTypes: new Set(hiddenAgentTypes ?? [])
		})
	);
	const rows = $derived(rowMap(scene, showWorktrees, rowGeom(density)));
	const legend = $derived(legendGroups(scene, showWorktrees));
	const wtId = $derived(highlightedWorktreeId !== undefined ? highlightedWorktreeId : internalWtId);
	const until = $derived(trace.trace.observedUntilMs);

	const selSpan = $derived(selectedSpanId !== undefined ? selectedSpanId : internalSpanId);

	const fitPx = $derived(fitPxPerMs(width, until));
	const minPx = $derived(fitPx);
	// Zoom in to at least 200 px/s (single tool calls), however long the trace.
	const maxPx = $derived(Math.max(0.2, fitPx * 8));
	const pxPerMs = $derived(userView?.pxPerMs ?? fitPx);
	const viewStartMs = $derived(userView?.viewStartMs ?? 0);
	const windowMs = $derived((width - GEOM.left - GEOM.right) / pxPerMs);

	// New trace: reset view, collapse and event selection.
	$effect.pre(() => {
		void trace;
		untrack(() => {
			userView = null;
			density = 1;
			collapsed = new Set();
			selectedEventId = null;
			internalSpanId = null;
			internalWtId = null;
		});
	});

	// ---- selection ----
	function selectSpan(id: string | null) {
		if (selectedSpanId === undefined) internalSpanId = id;
		if (selectedEventId !== null) {
			selectedEventId = null;
			onEventSelect?.(null);
		}
		onSpanSelect?.(id);
	}
	function selectEvent(id: string | null) {
		selectedEventId = id;
		if (id !== null && selSpan !== null) {
			if (selectedSpanId === undefined) internalSpanId = null;
			onSpanSelect?.(null);
		}
		onEventSelect?.(id);
	}
	function clearSelection() {
		if (selSpan !== null) selectSpan(null);
		else if (selectedEventId !== null) selectEvent(null);
	}
	/** Toggle: selecting the highlighted worktree again clears it. */
	function toggleWorktree(id: string) {
		const next = wtId === id ? null : id;
		if (highlightedWorktreeId === undefined) internalWtId = next;
		onWorktreeSelect?.(next);
	}
	// "Steps only": collapse the internals of every work item step (spans tagged with a work
	// item), leaving the flow of steps; toggling again restores just those (double-click still
	// expands one step).
	const hasWorkItems = $derived(scene.index.workItems.size > 0);
	const stepsOnlyIds = $derived(stepsOnlyCollapse(scene.index));
	const stepsOnly = $derived(stepsOnlyIds.length > 0 && stepsOnlyIds.every((id) => collapsed.has(id)));
	function toggleStepsOnly() {
		const next = new Set(collapsed);
		for (const id of stepsOnlyIds) stepsOnly ? next.delete(id) : next.add(id);
		collapsed = next;
	}
	/** Select and reveal the previous (-1) / next (+1) step of the selected span's work item. */
	function stepNav(dir: -1 | 1) {
		const pos = stepPosition(scene, selSpan);
		const target = pos ? (dir < 0 ? pos.prevId : pos.nextId) : scene.workItems[0]?.stepIds[0];
		if (target) navigate(target);
	}

	function toggleCollapse(id: string) {
		const next = new Set(collapsed);
		if (!next.delete(id)) next.add(id);
		collapsed = next;
	}

	/**
	 * Standalone SVG of the current filters, collapse, worktree overlay and highlight
	 * (transient selection is not exported),
	 * fit to the whole trace (independent of zoom/pan). Browser only.
	 */
	export function exportSvg(widthPx?: number): string {
		return exportTimelineSvg(trace, {
			showTools,
			showModelCalls,
			showConnectors,
			showWorktrees,
			collapsedSpanIds: collapsed,
			hiddenAgentTypes,
			highlightedWorktreeId: wtId,
			width: widthPx
		});
	}

	// ---- viewport ----
	function setView(start: number, px: number) {
		const p = Math.min(Math.max(px, minPx), maxPx);
		const win = (width - GEOM.left - GEOM.right) / p;
		const lo = -win * 0.25;
		const hi = Math.max(lo, until - win * 0.75);
		userView = { viewStartMs: Math.min(Math.max(start, lo), hi), pxPerMs: p };
	}
	/**
	 * One zoom axis: time zoom down to "fit", then (zooming out further) vertical density down
	 * to MIN_DENSITY, where rows are a few px tall and labels/chips are hidden. Zooming in
	 * restores density first, then zooms time again.
	 */
	function zoomAt(factor: number, anchorPx: number, anchorY?: number) {
		const atFit = pxPerMs <= minPx * 1.0001;
		if ((factor < 1 && atFit) || (factor > 1 && density < 1)) {
			setDensity(density * factor, anchorY);
			return;
		}
		const p = Math.min(Math.max(pxPerMs * factor, minPx), maxPx);
		const anchorMs = viewStartMs + (anchorPx - GEOM.left) / pxPerMs;
		setView(anchorMs - (anchorPx - GEOM.left) / p, p);
	}
	/** Change density keeping the content under `anchorY` (px from the chart top) in place. */
	function setDensity(d: number, anchorY?: number) {
		const next = Math.min(1, Math.max(MIN_DENSITY, d));
		if (next === density) return;
		const el = scrollEl;
		const y = anchorY ?? (el ? el.clientHeight / 2 : 0);
		const frac = el ? (el.scrollTop + y) / Math.max(1, rows.height) : 0;
		density = next;
		if (el) void tick().then(() => (el.scrollTop = Math.max(0, frac * rows.height - y)));
	}
	const zoomCenter = (factor: number) => zoomAt(factor, GEOM.left + (width - GEOM.left - GEOM.right) / 2);
	/** Show [startMs, endMs] with a little margin (clicked cluster of tiny bars). */
	function zoomToRange(startMs: number, endMs: number) {
		density = 1;
		const room = width - GEOM.left - GEOM.right;
		const span = Math.max(endMs - startMs, 1);
		const p = Math.min(Math.max((room * 0.8) / span, minPx), maxPx);
		setView(startMs - (room / p - span) / 2, p);
	}
	const fitAll = () => {
		userView = null;
		density = 1;
	};
	/** Whole trace on screen: fit time, then the largest density whose chart fits the visible height. */
	function overview() {
		userView = null;
		const room = scrollEl?.clientHeight ?? 0;
		if (!room) return;
		let lo = MIN_DENSITY;
		let hi = 1;
		if (rowMap(scene, showWorktrees, rowGeom(1)).height <= room) lo = 1;
		else
			for (let k = 0; k < 12; k++) {
				const mid = (lo + hi) / 2;
				if (rowMap(scene, showWorktrees, rowGeom(mid)).height <= room) lo = mid;
				else hi = mid;
			}
		density = lo;
		if (scrollEl) scrollEl.scrollTop = 0;
	}

	function panToSpan(id: string) {
		const item = scene.itemById.get(id);
		if (!item) return;
		if (item.startMs < viewStartMs || item.startMs > viewStartMs + windowMs || item.effectiveEndMs > viewStartMs + windowMs) {
			const span = item.effectiveEndMs - item.startMs;
			const start = span < windowMs * 0.8 ? item.startMs - (windowMs - span) / 2 : item.startMs - windowMs * 0.1;
			setView(start, pxPerMs);
		}
		if (scrollEl) {
			const y = rows.y[item.row];
			if (y < scrollEl.scrollTop || y + rows.g.barH > scrollEl.scrollTop + scrollEl.clientHeight)
				scrollEl.scrollTop = Math.max(0, y - GEOM.rulerH - rows.g.rowPitch * 2);
		}
	}
	function navigate(id: string) {
		selectSpan(id);
		panToSpan(id);
	}

	// Ctrl/Cmd + wheel (and trackpad pinch) zooms at the pointer; horizontal wheel or Shift+wheel pans;
	// plain vertical wheel scrolls the page/area.
	$effect(() => {
		const el = scrollEl;
		if (!el) return;
		// Wheel/pinch events arrive far faster than frames: accumulate and apply once per frame,
		// so a burst never queues up renders (which reads as laggy scrolling).
		let zoomF = 1;
		let panPx = 0;
		let anchor: [number, number] = [0, 0];
		let raf = 0;
		const flush = () => {
			raf = 0;
			if (zoomF !== 1) zoomAt(zoomF, anchor[0], anchor[1]);
			if (panPx) setView(viewStartMs + panPx / pxPerMs, pxPerMs);
			zoomF = 1;
			panPx = 0;
		};
		const schedule = () => (raf ||= requestAnimationFrame(flush));
		const onWheel = (e: WheelEvent) => {
			// Normalize to pixels: Firefox reports lines, some devices pages.
			const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientWidth : 1;
			const dx = e.deltaX * unit;
			const dy = e.deltaY * unit;
			if (e.ctrlKey || e.metaKey) {
				e.preventDefault();
				// Pinch sends many small deltas, a mouse notch one large one: steep gain, clamped per event.
				const factor = Math.min(1.5, Math.max(1 / 1.5, Math.exp(-dy * 0.01)));
				const box = el.getBoundingClientRect();
				anchor = [e.clientX - box.left, e.clientY - box.top];
				zoomF *= factor;
				schedule();
			} else if (e.shiftKey || Math.abs(dx) > Math.abs(dy)) {
				e.preventDefault();
				const d = Math.abs(dx) > Math.abs(dy) ? dx : dy;
				panPx += d;
				schedule();
			}
		};
		el.addEventListener('wheel', onWheel, { passive: false });
		return () => {
			el.removeEventListener('wheel', onWheel);
			if (raf) cancelAnimationFrame(raf);
		};
	});

	// Drag on empty background (including a worktree region's body) pans horizontally; a click
	// (no drag) on empty background clears selection. Pointer capture starts only once a drag is
	// recognised, so plain clicks still reach the region under the pointer.
	let drag: { x: number; start: number; moved: boolean; id: number } | null = null;
	function onPointerDown(e: PointerEvent) {
		if (e.button !== 0) return;
		if ((e.target as Element).closest('[data-span-id],[data-event-id],[data-worktree-chip]')) return;
		drag = { x: e.clientX, start: viewStartMs, moved: false, id: e.pointerId };
	}
	function onPointerMove(e: PointerEvent) {
		if (!drag || e.pointerId !== drag.id) return;
		if (e.buttons === 0) {
			drag = null;
			return;
		}
		const dx = e.clientX - drag.x;
		if (!drag.moved && Math.abs(dx) < 4) return;
		if (!drag.moved) scrollEl?.setPointerCapture(e.pointerId);
		drag.moved = true;
		panning = true;
		setView(drag.start - dx / pxPerMs, pxPerMs);
	}
	function onPointerUp(e: PointerEvent) {
		if (!drag || e.pointerId !== drag.id) return;
		const moved = drag.moved;
		drag = null;
		panning = false;
		if (!moved) clearSelection();
	}

	function onKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape') clearSelection();
		else if (e.key === '+' || e.key === '=') zoomCenter(1.5);
		else if (e.key === '-') zoomCenter(1 / 1.5);
		else if (e.key === '0') fitAll();
		else if (e.key === '9') overview();
		else if (e.key === '[') stepNav(-1);
		else if (e.key === ']') stepNav(1);
		else if (e.key === 'ArrowLeft' && e.altKey) {
			// Alt+Arrow is browser Back/Forward on Windows/Linux; never let it leave the page.
			e.preventDefault();
			setView(viewStartMs - windowMs * 0.2, pxPerMs);
		} else if (e.key === 'ArrowRight' && e.altKey) {
			e.preventDefault();
			setView(viewStartMs + windowMs * 0.2, pxPerMs);
		}
	}
</script>

<div class="at-host">
<div class="work-timeline" role="presentation" tabindex="-1" onkeydown={onKeyDown}>
	<section class="card main" aria-label="Timeline">
		<div class="toolbar" role="toolbar" aria-label="Timeline controls">
			<span class="hint">Ctrl/⌘ + wheel or pinch to zoom (past Fit: compact rows) · Shift + wheel or drag to pan · double-click a bar to collapse · Esc clears</span>
			<div class="seg" role="group" aria-label="Zoom">
				<button type="button" onclick={() => zoomCenter(1 / 1.5)} aria-label="Zoom out" title="Zoom out (−)">−</button>
				<button type="button" onclick={() => zoomCenter(1.5)} aria-label="Zoom in" title="Zoom in (+)">+</button>
				<button type="button" onclick={fitAll} aria-label="Fit time" title="Fit time, normal rows (0)" class="fit">Fit</button>
				<button type="button" onclick={overview} aria-label="Overview" title="Whole trace on screen (9)" class="fit">Overview</button>
			</div>
			{#if hasWorkItems}
				<div class="seg" role="group" aria-label="Work items">
					<button type="button" onclick={() => stepNav(-1)} aria-label="Previous step" title="Previous step of the selected work item ([)">‹</button>
					<button type="button" onclick={() => stepNav(1)} aria-label="Next step" title="Next step of the selected work item (])">›</button>
					<button
						type="button"
						class="fit"
						aria-pressed={stepsOnly}
						onclick={toggleStepsOnly}
						title="Collapse the internals of every work item step"
						disabled={!stepsOnlyIds.length}>Steps only</button
					>
				</div>
			{/if}
		</div>
		<div
			class="chart"
			class:panning
			bind:this={scrollEl}
			bind:clientWidth={width}
			role="presentation"
			onpointerdown={onPointerDown}
			onpointermove={onPointerMove}
			onpointerup={onPointerUp}
			onpointercancel={onPointerUp}
			onscroll={trackScroll}
		>
			{#if width > 0}
				<TimelineSvg
					{scene}
					{width}
					{pxPerMs}
					{viewStartMs}
					{density}
					{visibleY}
					onRangeZoom={zoomToRange}
					selectedSpanId={selSpan}
					{selectedEventId}
					{showConnectors}
					{showWorktrees}
					highlightedWorktreeId={wtId}
					onWorktreeSelect={toggleWorktree}
					title={trace.trace.title ?? trace.trace.id}
					onSpanSelect={selectSpan}
					onSpanToggle={toggleCollapse}
					onEventSelect={selectEvent}
				/>
			{/if}
		</div>
		<div class="foot">
			<Legend groups={legend} highlightedWorktreeId={wtId} onWorktreeSelect={toggleWorktree} />
		</div>
	</section>
	<div class="card panel">
		<DetailsPanel
			{scene}
			selectedSpanId={selSpan}
			{selectedEventId}
			{collapsed}
			onNavigate={navigate}
			onSelectEvent={selectEvent}
			onToggleCollapse={toggleCollapse}
		/>
	</div>
</div>
</div>

<style>
	.at-host {
		container-type: inline-size;
		width: 100%;
		min-width: 0;
	}
	.work-timeline {
		--line: #e6e8ec;
		--ink: #1f2430;
		--muted: #6b7280;
		--accent: #2f5fd0;
		display: grid;
		grid-template-columns: minmax(0, 1fr) 21rem;
		gap: 16px;
		align-items: start;
		width: 100%;
		min-width: 0;
		outline: none;
		color: var(--ink);
		font-family: Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
	}
	.card {
		background: #fff;
		border: 1px solid var(--line);
		border-radius: 10px;
		box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
		min-width: 0;
	}
	.main {
		overflow: hidden;
	}
	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 8px 12px;
		border-bottom: 1px solid var(--line);
	}
	.hint {
		font-size: 11.5px;
		color: #8a919e;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.seg {
		display: inline-flex;
		flex: none;
		border: 1px solid #d9dce3;
		border-radius: 7px;
		overflow: hidden;
		background: #fff;
	}
	.seg button {
		font: inherit;
		font-size: 13px;
		line-height: 1;
		min-width: 30px;
		height: 26px;
		padding: 0 9px;
		border: 0;
		border-left: 1px solid #d9dce3;
		background: #fff;
		color: #3a4252;
		cursor: pointer;
	}
	.seg button:first-child {
		border-left: 0;
	}
	.seg button.fit {
		font-size: 12px;
		font-weight: 500;
	}
	.seg button[aria-pressed='true'] {
		background: #e8eefb;
		color: #1f3f8f;
	}
	.seg button:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.seg button:hover {
		background: #f3f4f6;
	}
	.seg button:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}
	.chart {
		overflow-x: hidden;
		overflow-y: auto;
		max-height: min(68vh, 700px);
		background: #fff;
		touch-action: pan-y;
		min-width: 0;
	}
	.chart.panning {
		cursor: grabbing;
		user-select: none;
	}
	.chart :global(svg) {
		display: block;
	}
	.foot {
		padding: 9px 14px;
		border-top: 1px solid var(--line);
		background: #fafbfc;
	}
	.panel {
		position: sticky;
		top: 12px;
		padding: 16px;
		max-height: calc(100vh - 24px);
		overflow: auto;
	}
	@container (max-width: 880px) {
		.work-timeline {
			grid-template-columns: minmax(0, 1fr);
		}
		.panel {
			position: static;
			max-height: none;
		}
	}
</style>
