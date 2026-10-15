<script lang="ts">
	import type { TimelineScene } from '../layout/compute-layout.js';
	import { REGION, regionRects, type RowMap, type Viewport } from '../layout/geometry.js';
	import { formatRef, refAt } from '../model/indexes.js';
	import { measureText, type Measure } from '../layout/text.js';
	import type { WorktreeInfo } from '../layout/worktrees.js';

	interface Props {
		scene: TimelineScene;
		vp: Viewport;
		width: number;
		rows: RowMap;
		worktrees: ReadonlyMap<string, WorktreeInfo>;
		measure?: Measure;
		highlightedWorktreeId?: string | null;
		/** 'body': tinted rounded rectangles (behind bars); 'chip': label chips (above everything) */
		layer: 'body' | 'chip';
		interactive?: boolean;
		onSelect?: (id: string) => void;
		onHover?: (id: string | null) => void;
	}

	let {
		scene,
		vp,
		width,
		rows,
		worktrees,
		measure = measureText,
		highlightedWorktreeId = null,
		layer,
		interactive = true,
		onSelect,
		onHover
	}: Props = $props();

	const CHIP_FONT = 11;
	const rects = $derived(
		regionRects(scene, rows, vp)
			.filter((r) => r.x2 >= -4 && r.x1 <= width + 4)
			.flatMap((r) => {
				const info = worktrees.get(r.region.worktreeId);
				return info ? [{ ...r, info }] : [];
			})
	);

	function ellipsize(text: string, maxW: number, weight: number): string {
		if (measure(text, CHIP_FONT, weight) <= maxW) return text;
		let lo = 1;
		let hi = text.length;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (measure(text.slice(0, mid) + '…', CHIP_FONT, weight) <= maxW) lo = mid;
			else hi = mid - 1;
		}
		return text.slice(0, lo).trimEnd() + '…';
	}

	/** Chip geometry/text for a region, or undefined when too little of the region is visible. */
	function chipOf(r: (typeof rects)[number]) {
		const ref = formatRef(refAt(scene.index, r.region.worktreeId, r.region.startMs));
		const refText = ref === 'Unknown' ? '' : ref;
		const full = refText ? `${r.info.label} · ${refText}` : r.info.label;
		const left = Math.min(Math.max(r.x1 + 14, 6), r.x2 - 40);
		const right = Math.min(r.x2 - 10, width - 6);
		const avail = right - left;
		if (avail < 24) return undefined;
		const DOT = 12;
		const PADX = 9;
		const labelW = measure(r.info.label, CHIP_FONT, 600);
		const textRoom = avail - PADX * 2 - DOT;
		let label = r.info.label;
		let rest = refText ? ' · ' + refText : '';
		if (labelW + (rest ? measure(rest, CHIP_FONT) : 0) > textRoom) {
			if (labelW > textRoom) {
				label = ellipsize(label, textRoom, 600);
				rest = '';
			} else rest = ' · ' + ellipsize(refText, textRoom - labelW - measure(' · ', CHIP_FONT), 400);
		}
		// A chip reduced to a few letters ("noti…") is noise: show just the colour dot (the
		// tooltip and the box colour still identify the worktree).
		if (label !== r.info.label && label.length < 7) return { x: left, w: 22, label: '', rest: '', full };
		const w = PADX * 2 + DOT + measure(label, CHIP_FONT, 600) + (rest ? measure(rest, CHIP_FONT) : 0);
		return { x: left, w: Math.min(w, avail), label, rest, full };
	}

	function onKey(e: KeyboardEvent, id: string) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onSelect?.(id);
		}
	}
</script>

{#if layer === 'body'}
	<g class="at-regions">
		{#each rects as r (r.index)}
			{@const on = highlightedWorktreeId === r.info.id}
			{@const dim = !!highlightedWorktreeId && !on}
			<g
				class="at-region"
				data-worktree-id={r.info.id}
				data-region-root={r.region.rootSpanId}
				opacity={dim ? 0.35 : 1}
				role="presentation"
				onclick={interactive ? () => onSelect?.(r.info.id) : undefined}
				onpointerenter={interactive ? () => onHover?.(r.info.id) : undefined}
				onpointerleave={interactive ? () => onHover?.(null) : undefined}
			>
				<title>{r.info.label}</title>
				<rect
					x={r.x1}
					y={r.y1}
					width={Math.max(1, r.x2 - r.x1)}
					height={r.y2 - r.y1}
					rx={Math.min(REGION.radius, (r.y2 - r.y1) / 2)}
					fill={r.info.color}
					fill-opacity={on ? 0.12 : 0.06}
					stroke={r.info.color}
					stroke-opacity={on ? 0.85 : 0.4}
					stroke-width={on ? 1.5 : 1}
				/>
			</g>
		{/each}
	</g>
{:else}
	<g class="at-chips">
		{#each rows.g.chips ? rects : [] as r (r.index)}
			{@const chip = chipOf(r)}
			{#if chip}
				{@const on = highlightedWorktreeId === r.info.id}
				{@const dim = !!highlightedWorktreeId && !on}
				<!-- svelte-ignore a11y_no_noninteractive_tabindex (role is set whenever interactive) -->
				<g
					class="at-chip"
					data-worktree-id={r.info.id}
					data-worktree-chip="true"
					role={interactive ? 'button' : undefined}
					tabindex={interactive ? 0 : undefined}
					aria-label={interactive ? `Highlight worktree ${r.info.label}` : undefined}
					aria-pressed={interactive ? on : undefined}
					opacity={dim ? 0.35 : 1}
					onclick={interactive
						? (e) => {
								e.stopPropagation();
								onSelect?.(r.info.id);
							}
						: undefined}
					ondblclick={interactive ? (e) => e.stopPropagation() : undefined}
					onkeydown={interactive ? (e) => onKey(e, r.info.id) : undefined}
					onpointerenter={interactive ? () => onHover?.(r.info.id) : undefined}
					onpointerleave={interactive ? () => onHover?.(null) : undefined}
				>
					<title>Worktree: {chip.full}</title>
					<rect
						x={chip.x}
						y={r.y1 - REGION.chipH / 2}
						width={chip.w}
						height={REGION.chipH}
						rx={REGION.chipH / 2}
						fill="#ffffff"
						stroke={r.info.color}
						stroke-opacity={on ? 0.95 : 0.55}
					/>
					<circle cx={chip.x + 11} cy={r.y1} r="3" fill={r.info.color} />
					<text class="at-chip-text" x={chip.x + 20} y={r.y1 + 3.8} fill={r.info.ink}
						>{chip.label}{#if chip.rest}<tspan class="at-chip-ref" fill-opacity="0.8">{chip.rest}</tspan>{/if}</text
					>
					<rect class="at-focus" x={chip.x - 2} y={r.y1 - REGION.chipH / 2 - 2} width={chip.w + 4} height={REGION.chipH + 4} rx={REGION.chipH / 2 + 2} />
				</g>
			{/if}
		{/each}
	</g>
{/if}
