<script lang="ts">
	import type { PositionedEvent } from '../layout/compute-layout.js';
	import type { WorkEvent } from '../model/types.js';
	import { ERROR } from '../layout/colors.js';
	import { timeToX, type Viewport } from '../layout/geometry.js';
	import { formatSeconds } from '../layout/time.js';

	/** "tokens 182k→41k"; omitted pieces show as "?" (never 0), absent entirely → undefined. */
	function tokenSummary(e: WorkEvent): string | undefined {
		if (e.tokensBefore === undefined && e.tokensAfter === undefined) return undefined;
		const fmt = (n: number | undefined) =>
			n === undefined ? '?' : n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n);
		return `tokens ${fmt(e.tokensBefore)}→${fmt(e.tokensAfter)}`;
	}

	interface Props {
		event: WorkEvent;
		positioned: PositionedEvent;
		vp: Viewport;
		/** marker centre: the top edge of the anchor bar, or the middle of the event strip */
		cy: number;
		/** duration overlay box (the anchor bar's box, or a thin band in the strip) */
		overlayY: number;
		overlayH: number;
		/** marker size factor (row density; 1 = normal) */
		scale?: number;
		selected?: boolean;
		dimmed?: boolean;
		/** false in static exports */
		interactive?: boolean;
		onSelect?: (id: string) => void;
	}

	let { event, positioned, vp, cy, overlayY, overlayH, scale = 1, selected = false, dimmed = false, interactive = true, onSelect }: Props = $props();

	const x = $derived(timeToX(vp, positioned.atMs));
	// On a bar the diamond sits mostly in the gap above it, clear of the label text.
	const my = $derived(positioned.position === 'bar' ? cy - 2.5 : cy);
	const x2 = $derived(positioned.endMs === undefined ? undefined : timeToX(vp, positioned.endMs));
	const failed = $derived(event.kind === 'compaction' && event.outcome === 'error');
	const r = $derived((selected ? 5.5 : failed ? 5 : 4) * Math.max(0.6, scale));
	const strip = $derived(positioned.position === 'event-strip');
	const label = $derived(event.label ?? `Compaction`);
	const summary = $derived(
		[
			label,
			failed ? 'failed' : event.outcome && event.outcome !== 'unknown' ? event.outcome : undefined,
			event.endMs !== undefined ? formatSeconds(event.endMs - event.atMs) : undefined,
			tokenSummary(event),
			strip ? 'not attached to an active run' : undefined
		]
			.filter(Boolean)
			.join(' · ')
	);

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onSelect?.(event.id);
		}
	}
</script>

{#if x2 !== undefined}
	<!-- duration: a thin band, along the bar's top edge (or inside the event strip) -->
	<rect
		class="at-event-span"
		pointer-events="none"
		opacity={dimmed ? 0.3 : 1}
		x={x}
		y={strip ? overlayY : overlayY - 1}
		width={Math.max(2, x2 - x)}
		height={strip ? overlayH : 3}
		rx="1.5"
		fill={failed ? ERROR : '#1f2430'}
		fill-opacity={strip ? 0.12 : 0.55}
	/>
{/if}
<!-- svelte-ignore a11y_no_noninteractive_tabindex (role is set whenever interactive) -->
<g
	class="at-marker"
	data-event-id={event.id}
	role={interactive ? 'button' : undefined}
	tabindex={interactive ? 0 : undefined}
	aria-label={interactive ? `Event: ${summary}` : undefined}
	aria-pressed={interactive ? selected : undefined}
	opacity={dimmed ? 0.3 : 1}
	onclick={(e) => {
		e.stopPropagation();
		onSelect?.(event.id);
	}}
	onkeydown={onKey}
>
	<title>{summary}</title>
	{#if selected}
		<path
			d="M{x} {my - r - 4}L{x + r + 4} {my}L{x} {my + r + 4}L{x - r - 4} {my}Z"
			fill="none"
			stroke="#1f2430"
			stroke-opacity="0.14"
			stroke-width="4"
			stroke-linejoin="round"
		/>
	{/if}
	<path
		d="M{x} {my - r}L{x + r} {my}L{x} {my + r}L{x - r} {my}Z"
		fill={failed ? ERROR : selected ? '#1f2430' : '#ffffff'}
		stroke={failed ? '#ffffff' : '#1f2430'}
		stroke-width="1.25"
		stroke-linejoin="round"
	/>
	<circle class="at-focus" cx={x} cy={my} r={r + 5} />
	<circle cx={x} cy={my} r="9" fill="transparent" />
</g>
