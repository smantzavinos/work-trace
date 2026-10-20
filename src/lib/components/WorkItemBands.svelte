<script lang="ts">
	// Work item bands: a soft tinted pill behind consecutive steps of one work item in one row
	// (layout guarantees nothing else lies inside it), titled just above the bars. The title
	// sticks to the left edge of the view while its band is scrolled partly out of view.
	import { tintOnWhite, workItemColor } from '../layout/colors.js';
	import type { TimelineScene, WorkItemBand } from '../layout/compute-layout.js';
	import { BAND, timeToX, type RowMap, type Viewport } from '../layout/geometry.js';
	import { measureText, type Measure } from '../layout/text.js';

	interface Props {
		scene: TimelineScene;
		vp: Viewport;
		width: number;
		rows: RowMap;
		measure?: Measure;
		/** work item ids to emphasize (selection / hover); others fade while any is set */
		focused?: ReadonlySet<string>;
		/** something else is highlighted: fade all bands not in `focused` */
		faded?: boolean;
	}
	let { scene, vp, width, rows, measure = measureText, focused, faded = false }: Props = $props();

	const ids = $derived(scene.workItems.map((w) => w.workItemId));
	const info = $derived(new Map(scene.workItems.map((w) => [w.workItemId, w])));
	const FONT = 10.5;

	function title(b: WorkItemBand): string {
		const w = info.get(b.workItemId);
		if (!w) return b.workItemId;
		const n = w.stepIds.length;
		return b.first ? `${w.label}${n > 1 ? ` · ${n} steps` : ''}` : `${w.label} (cont.)`;
	}

	const shown = $derived(
		scene.workItemBands.flatMap((b) => {
			const x1 = timeToX(vp, b.startMs) - BAND.pad - 1;
			const x2 = timeToX(vp, b.endMs) + BAND.pad + 1;
			if (x2 < -20 || x1 > width + 20) return [];
			const y0 = rows.y[b.row];
			if (y0 === undefined) return [];
			const titleH = rows.bandTop[b.row] ?? 0;
			const text = title(b);
			const tw = measure(text, FONT, 600);
			// sticky: from the band's left edge, clamped into view, never past the band's right end
			const tx = Math.min(Math.max(x1 + 6, 6), x2 - tw - 6);
			const strong = !!focused?.has(b.workItemId);
			return [
				{
					key: `${b.workItemId}:${b.row}:${b.startMs}`,
					b,
					x1,
					x2,
					y1: y0 - BAND.pad - titleH,
					y2: y0 + rows.g.barH + BAND.pad,
					titleY: y0 - BAND.pad - 1,
					text,
					// a title only where it fits inside the band
					showTitle: titleH > 0 && tx >= x1 + 2,
					tx,
					color: workItemColor(ids, b.workItemId),
					strong,
					dim: faded && !strong
				}
			];
		})
	);
</script>

<g class="at-work-bands" pointer-events="none">
	{#each shown as s (s.key)}
		<g class="at-work-band" data-work-item-id={s.b.workItemId} opacity={s.dim ? 0.35 : 1}>
			<rect
				x={s.x1}
				y={s.y1}
				width={Math.max(0, s.x2 - s.x1)}
				height={s.y2 - s.y1}
				rx={Math.min(8, (s.y2 - s.y1) / 2)}
				fill={tintOnWhite(s.color, s.strong ? 0.16 : 0.08)}
				stroke={s.color}
				stroke-opacity={s.strong ? 0.8 : 0.4}
				stroke-width={s.strong ? 1.5 : 1}
			/>
			{#if s.showTitle}
				<text class="at-work-title" x={s.tx} y={s.titleY} fill={s.color}>{s.text}</text>
			{/if}
		</g>
	{/each}
</g>
