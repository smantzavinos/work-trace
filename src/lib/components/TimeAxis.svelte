<script lang="ts">
	import { GEOM, timeToX, type Viewport } from '../layout/geometry.js';
	import { measureText } from '../layout/text.js';
	import { axisTicks, formatElapsed } from '../layout/time.js';

	interface Props {
		vp: Viewport;
		width: number;
		/** full chart height; grid lines extend to here */
		height: number;
		observedUntilMs: number;
	}

	let { vp, width, height, observedUntilMs }: Props = $props();

	const axis = $derived(
		axisTicks(
			vp.viewStartMs,
			Math.min(observedUntilMs, vp.viewStartMs + (width - vp.left) / vp.pxPerMs),
			vp.pxPerMs,
			84
		)
	);
	const untilX = $derived(timeToX(vp, observedUntilMs));
	const untilText = $derived(`observed until ${formatElapsed(observedUntilMs, 1000)}`);
	const untilLabelW = $derived(measureText(untilText, 10.5));
	const crisp = (x: number) => Math.round(x) + 0.5;
	const R = GEOM.rulerH;
</script>

<g class="at-axis">
	<line x1="0" x2={width} y1={R - 0.5} y2={R - 0.5} stroke="#e1e4ea" />
	{#each axis.ticks as t (t)}
		{@const tx = crisp(timeToX(vp, t))}
		{@const label = formatElapsed(t, axis.interval)}
		{@const hidden = tx + 4 + measureText(label, 11) > untilX - untilLabelW - 14 && tx < untilX + 2}
		<line x1={tx} x2={tx} y1={R} y2={height} stroke="#f0f1f4" shape-rendering="crispEdges" />
		<line x1={tx} x2={tx} y1={R - 5} y2={R - 0.5} stroke="#c3c8d1" shape-rendering="crispEdges" />
		{#if !hidden}
			<text class="at-tick-label" x={tx + 4} y="17">{label}</text>
		{/if}
	{/each}
	{#if untilX >= -1 && untilX <= width + 1}
		<line
			class="at-observed-until"
			x1={crisp(untilX)}
			x2={crisp(untilX)}
			y1="0"
			y2={height}
			stroke="#c9741f"
			stroke-opacity="0.75"
			stroke-width="1"
			shape-rendering="crispEdges"
		/>
		<text class="at-until-label" x={untilX - 6} y="17" text-anchor="end">
			{untilText}
		</text>
	{/if}
</g>
