<script lang="ts">
	import type { LegendEntry, LegendGroup } from '../layout/legend.js';
	import LegendSwatch from './LegendSwatch.svelte';

	interface Props {
		groups: readonly LegendGroup[];
		highlightedWorktreeId?: string | null;
		onWorktreeSelect?: (id: string) => void;
	}
	let { groups, highlightedWorktreeId = null, onWorktreeSelect }: Props = $props();
	const uid = $props.id();
	const isWorktree = (e: LegendEntry) => e.kind === 'worktree' || e.kind === 'base';
</script>

<!-- One row per group: a small caption, then that group's entries. -->
<dl class="legend" aria-label="Legend">
	{#each groups as group, gi (group.title)}
		<dt>{group.title}</dt>
		<dd>
			<ul>
				{#each group.entries as e, i (e.kind + ':' + (e.ref ?? e.text))}
					<li>
						{#if isWorktree(e)}
							<button
								type="button"
								class="wt"
								class:on={highlightedWorktreeId === e.ref}
								aria-pressed={highlightedWorktreeId === e.ref}
								title="Highlight {e.text}"
								onclick={() => e.ref && onWorktreeSelect?.(e.ref)}
							>
								<svg width="18" height="14" aria-hidden="true"
									><LegendSwatch kind={e.kind} color={e.color} uid="{uid}-{gi}-{i}" /></svg
								>
								<span class="t">{e.text}</span>{#if e.note}<span class="note">{e.note}</span>{/if}
							</button>
						{:else}
							<svg width="18" height="14" aria-hidden="true"
								><LegendSwatch kind={e.kind} color={e.color} uid="{uid}-{gi}-{i}" /></svg
							>
							<span class="t">{e.text}</span>{#if e.note}<span class="note">{e.note}</span>{/if}
						{/if}
					</li>
				{/each}
			</ul>
		</dd>
	{/each}
</dl>

<style>
	.legend {
		display: grid;
		grid-template-columns: max-content 1fr;
		align-items: baseline;
		gap: 0.3rem 1rem;
		margin: 0;
		font-size: 11.5px;
		color: #3a4252;
	}
	dt {
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #8a919e;
	}
	dd {
		margin: 0;
	}
	ul {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem 1.1rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}
	.t {
		font-weight: 500;
	}
	.note {
		color: #8a919e;
		margin-left: 0.15rem;
	}
	.wt {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font: inherit;
		color: inherit;
		background: none;
		border: 1px solid transparent;
		border-radius: 6px;
		padding: 1px 6px 1px 4px;
		margin: -2px -7px;
		cursor: pointer;
	}
	.wt:hover {
		background: #f3f4f6;
	}
	.wt.on {
		border-color: #cfd4dc;
		background: #f3f4f6;
	}
	.wt:focus-visible {
		outline: 2px solid #2f5fd0;
		outline-offset: 1px;
	}
</style>
