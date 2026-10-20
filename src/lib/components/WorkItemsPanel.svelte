<script lang="ts">
	import type { TimelineScene } from '../layout/compute-layout.js';
	import { workItemColor } from '../layout/colors.js';
	import { flowOf, spanLabel } from '../layout/selection.js';
	import { formatSeconds } from '../layout/time.js';

	interface Props {
		scene: TimelineScene;
		selectedSpanId?: string | null;
		/** work item under the pointer / keyboard focus (null when leaving the list) */
		onHover?: (workItemId: string | null) => void;
		/** select a span and reveal it in the chart */
		onNavigate: (spanId: string) => void;
	}

	let { scene, selectedSpanId = null, onHover, onNavigate }: Props = $props();

	const index = $derived(scene.index);
	const until = $derived(index.trace.trace.observedUntilMs);
	const current = $derived(flowOf(index, selectedSpanId).workItemIds);

	// Every work item in the trace, in first-step order; items with no visible step come last.
	const items = $derived.by(() => {
		const ids = scene.workItems.map((w) => w.workItemId);
		const visible = new Map(scene.workItems.map((w) => [w.workItemId, w.stepIds]));
		const all = [...index.workItems.values()].map((w) => {
			const spans = index.workItemSpans.get(w.id) ?? [];
			const start = spans.length ? Math.min(...spans.map((s) => s.startMs)) : undefined;
			const end = spans.length ? Math.max(...spans.map((s) => s.endMs ?? until)) : undefined;
			return {
				w,
				stepIds: visible.get(w.id) ?? [],
				spanCount: spans.length,
				start,
				end,
				running: spans.some((s) => s.endMs === undefined),
				failed: spans.some((s) => s.status === 'error'),
				color: visible.has(w.id) ? workItemColor(ids, w.id) : '#9aa3b2',
				order: ids.indexOf(w.id)
			};
		});
		return all.sort((a, b) => (a.order < 0 ? 1e9 : a.order) - (b.order < 0 ? 1e9 : b.order) || (a.w.id < b.w.id ? -1 : 1));
	});
</script>

<div class="work-items" role="list" aria-label="Work items" onpointerleave={() => onHover?.(null)}>
	{#each items as it (it.w.id)}
		<div
			class="item"
			class:current={current.has(it.w.id)}
			role="listitem"
			data-work-item-id={it.w.id}
			style:--wi={it.color}
			onpointerenter={() => onHover?.(it.w.id)}
			onfocusin={() => onHover?.(it.w.id)}
			onfocusout={() => onHover?.(null)}
		>
			<div class="head">
				<i class="dot" aria-hidden="true"></i>
				{#if it.stepIds.length}
					<button type="button" class="title" onclick={() => onNavigate(it.stepIds[0])} title="Select the first step">{it.w.label}</button>
				{:else}
					<span class="title">{it.w.label}</span>
				{/if}
			</div>
			<div class="meta">
				{#if it.stepIds.length}{it.stepIds.length} {it.stepIds.length === 1 ? 'step' : 'steps'}{:else}hidden in this view{/if}
				{#if it.start !== undefined && it.end !== undefined}
					· {formatSeconds(it.start)}–{formatSeconds(it.end)}{it.running ? ' (running)' : ''}
				{:else}
					· no spans
				{/if}
				{#if it.failed}<span class="err">· error</span>{/if}
			</div>
			{#if it.stepIds.length}
				<ol class="steps">
					{#each it.stepIds as id, k (id)}
						{@const s = index.spans.get(id)}
						{#if s}
							<li class:sel={id === selectedSpanId}>
								<span class="num" aria-hidden="true">{k + 1}</span>
								<button type="button" class="step" onclick={() => onNavigate(id)} aria-current={id === selectedSpanId ? 'true' : undefined}>
									{spanLabel(index, s)}
								</button>
								<span class="dur">{formatSeconds((s.endMs ?? until) - s.startMs)}</span>
							</li>
						{/if}
					{/each}
				</ol>
			{/if}
		</div>
	{:else}
		<p class="empty">This trace has no work items.</p>
	{/each}
</div>

<style>
	.work-items {
		font-size: 12.5px;
		line-height: 1.45;
		color: #1f2430;
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
	}
	.item {
		border: 1px solid #e6e8ed;
		border-left: 3px solid var(--wi);
		border-radius: 7px;
		padding: 7px 9px 8px;
		background: #fff;
		transition: background-color 0.1s;
	}
	.item:hover,
	.item:focus-within {
		background: color-mix(in srgb, var(--wi) 7%, #fff);
	}
	.item.current {
		box-shadow: 0 0 0 1px var(--wi);
	}
	.head {
		display: flex;
		align-items: center;
		gap: 7px;
		min-width: 0;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--wi);
		flex: none;
	}
	.title {
		font: inherit;
		font-weight: 600;
		color: inherit;
		background: none;
		border: 0;
		padding: 0;
		text-align: left;
		overflow-wrap: anywhere;
	}
	button.title,
	.step {
		cursor: pointer;
	}
	button.title:hover,
	.step:hover {
		text-decoration: underline;
	}
	.meta {
		color: #6b7280;
		font-size: 11.5px;
		margin: 1px 0 0 15px;
	}
	.err {
		color: #b42318;
	}
	.steps {
		list-style: none;
		margin: 6px 0 0;
		padding: 0;
	}
	.steps li {
		display: flex;
		align-items: baseline;
		gap: 6px;
		padding: 1px 0;
		min-width: 0;
	}
	.num {
		flex: none;
		width: 15px;
		height: 15px;
		border-radius: 50%;
		background: var(--wi);
		color: #fff;
		font-size: 9.5px;
		font-weight: 700;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		align-self: center;
	}
	.step {
		font: inherit;
		color: #2848a8;
		background: none;
		border: 0;
		padding: 0;
		text-align: left;
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sel .step {
		font-weight: 600;
		color: #1f2430;
	}
	.dur {
		flex: none;
		color: #8a919e;
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}
	button:focus-visible {
		outline: 2px solid #3d63dd;
		outline-offset: 1px;
		border-radius: 3px;
	}
	.empty {
		color: #8a919e;
		margin: 8px 0;
	}
</style>
