<script lang="ts">
	import { ACCENT } from '../layout/colors.js';
	import type { TimelineScene } from '../layout/compute-layout.js';
	import { barWidth, rowGeom, timeToX, type RowGeom, type Viewport } from '../layout/geometry.js';
	import { sessionIdOf, type Highlight } from '../layout/selection.js';
	import { measureText, type Measure } from '../layout/text.js';
	import { formatSeconds } from '../layout/time.js';

	interface Props {
		scene: TimelineScene;
		vp: Viewport;
		width: number;
		/** top y of every lane row */
		ys: readonly number[];
		g?: RowGeom;
		measure?: Measure;
		highlight: Highlight;
		showConnectors?: boolean;
		/** session under the pointer: its pause links are emphasized */
		hoverSessionId?: string;
	}

	let { scene, vp, width, ys, g = rowGeom(1), measure = measureText, highlight, showConnectors = true, hoverSessionId }: Props = $props();

	const children = $derived(scene.items.filter((i) => i.visualParentId));
	// Pause links between consecutive runs of a session are always drawn: they are what makes
	// a resumed session readable at a glance. Selection or hover of the session emphasizes them.
	const resumes = $derived.by(() => {
		const byRow = new Map<number, { startMs: number; endMs: number; id: string }[]>();
		for (const i of scene.items) {
			const list = byRow.get(i.row) ?? [];
			list.push({ startMs: i.startMs, endMs: i.effectiveEndMs, id: i.id });
			byRow.set(i.row, list);
		}
		return scene.resumeEdges.flatMap((e) => {
			const from = scene.itemById.get(e.fromSpanId);
			const to = scene.itemById.get(e.toSpanId);
			if (!from || !to) return [];
			const session = sessionIdOf(scene.index, e.toSpanId);
			const sameRow = from.row === to.row;
			const clear =
				sameRow &&
				!(byRow.get(from.row) ?? []).some(
					(o) => o.id !== from.id && o.id !== to.id && o.startMs < to.startMs && o.endMs > from.effectiveEndMs
				);
			return [{ key: `${e.fromSpanId}>${e.toSpanId}`, e, from, to, session, sameRow, clear }];
		});
	});
	const PAUSE = '#8b93a1';
	const H = $derived(g.barH);

	/** Orthogonal elbow with small rounded corners: down/up from the parent, across, into the child. */
	function elbow(sx: number, py: number, cx: number, cy: number, mid: number): string {
		const dx = cx - sx;
		if (Math.abs(dx) < 1) return `M${sx} ${py}V${cy}`;
		const dir = cy > py ? 1 : -1;
		const sgn = dx > 0 ? 1 : -1;
		const r = Math.min(4, Math.abs(dx) / 2, Math.abs(mid - py) - 0.01, Math.abs(cy - mid));
		if (r < 1) return `M${sx} ${py}V${mid}H${cx}V${cy}`;
		return (
			`M${sx} ${py}V${mid - dir * r}Q${sx} ${mid} ${sx + sgn * r} ${mid}` +
			`H${cx - sgn * r}Q${cx} ${mid} ${cx} ${mid + dir * r}V${cy}`
		);
	}
</script>

<g class="at-relationships" pointer-events="none">
	{#if showConnectors}
		{#each children as child (child.id)}
			{@const parent = scene.itemById.get(child.visualParentId!)}
			{#if parent}
				{@const cx = timeToX(vp, child.startMs)}
				{#if cx >= -20 && cx <= width + 20}
					{@const px = timeToX(vp, parent.startMs)}
					{@const pw = barWidth(vp, parent.startMs, parent.effectiveEndMs)}
					{@const inset = pw > 20 ? 6 : 0}
					{@const sx = Math.min(Math.max(cx, px + inset), px + pw - inset)}
					{@const up = child.row <= parent.row}
					{@const py = up ? ys[parent.row] : ys[parent.row] + H}
					{@const cy = up ? ys[child.row] + H : ys[child.row]}
					{@const mid = up ? cy + 6 : cy - 6}
					{@const strong = highlight.lineage.has(child.id) && highlight.lineage.has(parent.id)}
					<path
						class="at-causal"
						data-child-id={child.id}
						d={elbow(sx, py, cx, cy, mid)}
						fill="none"
						stroke={strong ? '#3a4252' : '#c2c8d2'}
						stroke-width={strong ? 1.5 : 1}
						stroke-opacity={highlight.active && !strong ? 0.45 : 1}
						stroke-linejoin="round"
					/>
				{/if}
			{/if}
		{/each}
	{/if}
	{#each resumes as r (r.key)}
		{@const strong = !!r.session && (r.session === highlight.sessionId || r.session === hoverSessionId)}
		{@const faded = highlight.active && !strong}
		{@const x1 = timeToX(vp, r.from.effectiveEndMs)}
		{@const x2 = timeToX(vp, r.to.startMs)}
		{@const y1 = ys[r.from.row]}
		{@const y2 = ys[r.to.row]}
		{@const stroke = strong ? ACCENT : PAUSE}
		{@const sw = strong ? 1.75 : 1.25}
		{@const pause = `paused ${formatSeconds(r.to.startMs - r.from.effectiveEndMs)}`}
		<g
			class="at-resume"
			data-resume-from={r.e.fromSpanId}
			data-resume-to={r.e.toSpanId}
			opacity={faded ? 0.35 : 1}
		>
			<title>{pause}, then resumed</title>
			{#if r.clear}
				<!-- same row, nothing in between: a straight dotted pause line with its duration -->
				{@const my = y1 + H / 2}
				{@const tw = measure(pause, 10.5) + 10}
				<path d="M{x1 + 2} {my}H{x2 - 2}" fill="none" {stroke} stroke-width={sw} stroke-dasharray="1.5 3.5" stroke-linecap="round" />
				{#if g.labels && x2 - x1 >= tw + 16}
					<rect x={(x1 + x2) / 2 - tw / 2} y={my - 7.5} width={tw} height="15" rx="7.5" fill="#ffffff" stroke={stroke} stroke-opacity="0.35" />
					<text class="at-pause" x={(x1 + x2) / 2} y={my + 3.6} text-anchor="middle" fill={strong ? ACCENT : '#5b6474'}>{pause}</text>
				{/if}
			{:else if r.sameRow}
				<!-- same row with bars in between: a bracket through the gap above the row -->
				{@const gy = y1 - 4}
				<path d="M{x1 - 3} {y1 + 2}V{gy}H{x2 + 3}V{y1 + 2}" fill="none" {stroke} stroke-width={sw} stroke-dasharray="1.5 3.5" stroke-linecap="round" stroke-linejoin="round" />
			{:else}
				{@const dx = Math.max(24, Math.abs(x2 - x1) / 2)}
				<path
					d="M{x1} {y1 + H / 2}C{x1 + dx} {y1 + H / 2} {x2 - dx} {y2 + H / 2} {x2} {y2 + H / 2}"
					fill="none"
					{stroke}
					stroke-width={sw}
					stroke-dasharray="1.5 3.5"
					stroke-linecap="round"
				/>
			{/if}
		</g>
	{/each}
</g>
