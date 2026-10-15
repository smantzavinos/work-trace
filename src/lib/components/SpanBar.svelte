<script lang="ts">
	import { ACCENT, ERROR, type BarColor } from '../layout/colors.js';
	import type { LayoutItem } from '../layout/compute-layout.js';
	import { GEOM, barWidth, rowGeom, timeToX, type RowGeom, type Viewport } from '../layout/geometry.js';
	import { measureText, safeId, type Measure } from '../layout/text.js';
	import { formatSeconds } from '../layout/time.js';

	interface Props {
		item: LayoutItem;
		label: string;
		vp: Viewport;
		/** top of the bar */
		y: number;
		/** row metrics (bar height, whether labels are shown) */
		g?: RowGeom;
		/** text width function (exact in the browser, estimated in exports) */
		measure?: Measure;
		color: BarColor;
		idPrefix: string;
		selected?: boolean;
		sameSession?: boolean;
		dimmed?: boolean;
		/** causal descendants hidden by collapse */
		hiddenCount?: number;
		/** px free to the right of the bar before the next bar / region edge / chart edge */
		roomRight?: number;
		/** 1-based run number and run count of this span's agent session (agent spans only) */
		run?: { index: number; count: number };
		/** false in static exports: no roles, focus or pointer affordances */
		interactive?: boolean;
		onSelect?: (id: string) => void;
		onToggle?: (id: string) => void;
		/** pointer enters (id) / leaves (null) the bar */
		onHover?: (id: string | null) => void;
	}

	let {
		item,
		label,
		vp,
		y,
		g = rowGeom(1),
		measure = measureText,
		color,
		idPrefix,
		selected = false,
		sameSession = false,
		dimmed = false,
		hiddenCount = 0,
		roomRight = 0,
		run,
		interactive = true,
		onSelect,
		onToggle,
		onHover
	}: Props = $props();

	const h = $derived(g.barH);
	const PAD = 8;
	const x = $derived(timeToX(vp, item.startMs));
	const w = $derived(barWidth(vp, item.startMs, item.effectiveEndMs));
	const rx = $derived(Math.min(g.radius, w / 2));
	const span = $derived(item.span);
	const status = $derived(span.status);
	const running = $derived(status === 'running');
	const isResume = $derived(span.kind === 'agent' && span.mode === 'resume');
	const light = $derived(color.neutral);

	// Session continuity: a run that is resumed later ends in a chevron point; a resumed run
	// starts with a matching notch, so the pieces of one session visibly fit together.
	const multiRun = $derived(!!run && run.count > 1);
	const continues = $derived(!!run && run.index < run.count);
	const cd = $derived(Math.min(6, w / 4));
	const bodyPath = $derived.by(() => {
		const r = rx;
		const top = `M${isResume ? x : x + r} ${y}`;
		const right = continues
			? `H${x + w - cd}L${x + w} ${y + h / 2}L${x + w - cd} ${y + h}`
			: `H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h - r}Q${x + w} ${y + h} ${x + w - r} ${y + h}`;
		const left = isResume
			? `H${x}L${x + cd} ${y + h / 2}Z`
			: `H${x + r}Q${x} ${y + h} ${x} ${y + h - r}V${y + r}Q${x} ${y} ${x + r} ${y}Z`;
		return top + right + left;
	});

	const base = $derived(`${idPrefix}-b-${safeId(item.id)}`);
	const hitW = $derived(Math.max(w, GEOM.minHitW));
	const hitX = $derived(x - (hitW - w) / 2);

	// Running bars fade out over their last ~56px: an open right edge.
	const fadeFrom = $derived(Math.max(0, Math.min(0.85, 1 - 56 / Math.max(w, 1))));

	// ---- label placement ----
	const runTag = $derived(multiRun && run ? `${isResume ? '↻ ' : ''}${run.index}/${run.count}` : '');
	const prefix = $derived([item.collapsed ? `▸ +${hiddenCount}` : '', runTag].filter(Boolean).join(' '));
	const text = $derived(prefix ? `${prefix} ${label}` : label);
	const weight = $derived(light ? 400 : 500);
	const textW = $derived(measure(text, 12, weight));
	const showBang = $derived(status === 'error' && w >= 34 && g.labels);
	const textX = $derived(Math.max(x + (isResume ? cd : 0), 0) + PAD);
	const clipRight = $derived(x + w - (showBang ? 24 : PAD) - (continues ? cd : 0));
	const inner = $derived(clipRight - textX);
	const OUT_GAP = 7;
	const outRoom = $derived(roomRight - OUT_GAP - 2);
	// Full label inside, else full label to the right, else an ellipsized label inside the
	// bar when it has reasonable room, else outside. Nothing only when both spaces are tiny (the <title> still carries it).
	// A shortened label must keep enough of the name to be worth reading ("Inspe…" is noise).
	const minClipW = $derived(measure(`${prefix ? prefix + ' ' : ''}${label.slice(0, 6)}…`, 12, weight));
	const placement = $derived<'inside' | 'outside' | 'clipped' | 'outside-clipped' | 'none'>(
		!g.labels
			? 'none'
			: textW <= inner
			? 'inside'
			: textW <= outRoom
				? 'outside'
				: Math.max(inner, outRoom) < Math.max(40, minClipW)
					? 'none'
					: inner >= 56 || inner >= outRoom
						? 'clipped'
						: 'outside-clipped'
	);

	/** Longest prefix ending in "…" that fits `avail`; breaks at a word if that costs little. */
	function ellipsize(t: string, avail: number): string {
		const fits = (v: string) => measure(v, 12, weight) <= avail;
		// Binary search for the longest fitting prefix (log n measurements per label and zoom step).
		let lo = 1;
		let hi = t.length;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (fits(`${t.slice(0, mid).trimEnd()}…`)) lo = mid;
			else hi = mid - 1;
		}
		const n = lo;
		const cut = t.slice(0, n);
		const sp = cut.lastIndexOf(' ');
		const word = sp > 0 && sp >= n * 0.75 ? cut.slice(0, sp) : cut;
		return `${word.trimEnd()}…`;
	}
	const shownText = $derived(
		placement === 'clipped'
			? ellipsize(text, inner)
			: placement === 'outside-clipped'
				? ellipsize(text, outRoom)
				: text
	);

	const aria = $derived(
		`${span.kind} ${label}, ${status}, ${formatSeconds(item.effectiveEndMs - item.startMs)}${multiRun && run ? `, run ${run.index} of ${run.count}` : ''}${isResume ? ', resumed' : ''}`
	);

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onSelect?.(item.id);
		}
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex (role is set whenever interactive) -->
<g
	class="at-bar"
	data-span-id={item.id}
	role={interactive ? 'button' : undefined}
	tabindex={interactive ? 0 : undefined}
	aria-label={interactive ? aria : undefined}
	aria-pressed={interactive ? selected : undefined}
	opacity={dimmed ? 0.3 : 1}
	onclick={(e) => {
		e.stopPropagation();
		onSelect?.(item.id);
	}}
	ondblclick={(e) => {
		e.stopPropagation();
		if (item.hasChildren) onToggle?.(item.id);
	}}
	onkeydown={onKey}
	onpointerenter={() => onHover?.(item.id)}
	onpointerleave={() => onHover?.(null)}
>
	<title>{label} · {span.kind} · {status} · {formatSeconds(item.effectiveEndMs - item.startMs)}</title>
	{#if running}
		<defs>
			<linearGradient id="{base}-run" x1="0" x2="1" y1="0" y2="0">
				<stop offset="0" stop-color={color.fill} />
				<stop offset={fadeFrom} stop-color={color.fill} />
				<stop offset="1" stop-color={color.fill} stop-opacity={light ? 0 : 0.1} />
			</linearGradient>
		</defs>
	{/if}
	{#if placement === 'inside' || placement === 'clipped'}
		<defs>
			<clipPath id="{base}-clip"><rect x={textX} y={y} width={Math.max(0, inner)} height={h} /></clipPath>
		</defs>
	{/if}

	{#if selected}
		<rect x={x - 6} y={y - 6} width={w + 12} height={h + 12} rx={rx + 5} fill="none" stroke="#1f2430" stroke-opacity="0.12" stroke-width="4" />
		<rect x={x - 2.5} y={y - 2.5} width={w + 5} height={h + 5} rx={rx + 2} fill="none" stroke="#1f2430" stroke-width="2" />
	{:else if sameSession}
		<rect x={x - 2.5} y={y - 2.5} width={w + 5} height={h + 5} rx={rx + 2} fill="none" stroke={ACCENT} stroke-opacity="0.85" stroke-width="1.5" />
	{/if}

	{#if multiRun}
		<path class="at-body" d={bodyPath} fill={running ? `url(#${base}-run)` : color.fill} />
	{:else}
		<rect
			class="at-body"
			{x}
			{y}
			width={w}
			height={h}
			{rx}
			fill={running ? `url(#${base}-run)` : color.fill}
		/>
	{/if}
	{#if status === 'cancelled'}
		<rect x={x} y={y} width={w} height={h} {rx} fill="url(#{idPrefix}-hatch-{light ? 'd' : 'l'})" pointer-events="none" />
	{/if}
	{#if status === 'error'}
		<rect x={x + 1} y={y + 1} width={Math.max(0, w - 2)} height={h - 2} rx={Math.max(0, rx - 1)} fill="none" stroke={ERROR} stroke-width="2" />
	{:else if color.border && running}
		<path d="M{x + w} {y + 0.5}H{x + rx}Q{x + 0.5} {y + 0.5} {x + 0.5} {y + rx}V{y + h - rx}Q{x + 0.5} {y + h - 0.5} {x + rx} {y + h - 0.5}H{x + w}" fill="none" stroke={color.border} />
	{:else if color.border}
		<rect x={x + 0.5} y={y + 0.5} width={Math.max(0, w - 1)} height={h - 1} rx={Math.max(0, rx - 0.5)} fill="none" stroke={color.border} />
	{/if}

	{#each item.refTicksMs as t (t)}
		{@const tx = timeToX(vp, t)}
		<line
			class="at-ref-tick"
			x1={tx}
			x2={tx}
			y1={y + 4}
			y2={y + h - 4}
			stroke={light ? '#1f2430' : '#ffffff'}
			stroke-opacity={light ? 0.35 : 0.6}
			stroke-width="1"
		/>
	{/each}

	{#if placement === 'inside' || placement === 'clipped'}
		<text
			class="at-label"
			class:at-label-light={light}
			x={textX}
			y={y + h / 2 + 4.6}
			fill={color.text}
			clip-path="url(#{base}-clip)"
			>{#if prefix && shownText.startsWith(prefix)}<tspan class="at-run-tag">{prefix}</tspan>{shownText.slice(prefix.length)}{:else}{shownText}{/if}</text
		>
	{:else if placement === 'outside' || placement === 'outside-clipped'}
		<text class="at-label at-label-out" class:at-label-light={light} x={x + w + OUT_GAP} y={y + h / 2 + 4.6} fill="#3a4252"
			>{#if prefix && shownText.startsWith(prefix)}<tspan class="at-run-tag">{prefix}</tspan>{shownText.slice(prefix.length)}{:else}{shownText}{/if}</text
		>
	{/if}

	{#if showBang}
		<circle cx={x + w - 13} cy={y + h / 2} r="6.5" fill={ERROR} stroke="#ffffff" stroke-width="1.5" />
		<text class="at-glyph" x={x + w - 13} y={y + h / 2 + 3.6} text-anchor="middle" fill="#ffffff">!</text>
	{/if}

	<rect class="at-focus" x={x - 4} y={y - 4} width={w + 8} height={h + 8} rx={rx + 3} />
	<rect x={hitX} {y} width={hitW} height={h} fill="transparent" />
</g>
