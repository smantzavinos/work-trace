<script lang="ts">
	import { LEGEND, type PlacedLegendEntry, type PlacedLegendTitle } from '../layout/legend.js';
	import LegendSwatch from './LegendSwatch.svelte';

	interface Props {
		items: readonly PlacedLegendEntry[];
		titles: readonly PlacedLegendTitle[];
		width: number;
		/** top of the legend area */
		y: number;
		idPrefix: string;
	}
	let { items, titles, width, y, idPrefix }: Props = $props();
</script>

<g class="at-legend" transform="translate(0 {y})">
	<line x1="0" x2={width} y1="0.5" y2="0.5" stroke="#e6e8ec" />
	{#each titles as t (t.text)}
		<text class="at-legend-title" x={LEGEND.pad} y={t.y + 11}>{t.text}</text>
	{/each}
	{#each items as it, i (i)}
		<g class="at-legend-item" transform="translate({it.x} {it.y})">
			<LegendSwatch kind={it.kind} color={it.color} uid="{idPrefix}-lg{i}" />
			<text class="at-legend-text" x={LEGEND.swatchW + LEGEND.swatchGap} y="11"
				>{it.text}{#if it.note}<tspan class="at-legend-note" dx="5">{it.note}</tspan>{/if}</text
			>
		</g>
	{/each}
</g>
