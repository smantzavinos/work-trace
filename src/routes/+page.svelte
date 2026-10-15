<script lang="ts">
	import {
		WorkTimeline,
		validateTrace,
		type WorkTrace,
		type ValidationResult
	} from '#lib';
	import { onMount } from 'svelte';

	let result = $state<ValidationResult<WorkTrace> | null>(null);
	let source = $state('');
	let parseError = $state('');
	let sampleError = $state('');
	let showTools = $state(false);
	let showModelCalls = $state(false);
	let showConnectors = $state(true);
	let showWorktrees = $state(true);
	let selectedSpanId = $state<string | null>(null);
	let selectedEventId = $state<string | null>(null);
	let highlightedWorktreeId = $state<string | null>(null);
	let timeline = $state<ReturnType<typeof WorkTimeline>>();
	let dragging = $state(false);
	let exportError = $state('');

	const toggles = $derived([
		{ label: 'Tools', on: showTools, flip: () => (showTools = !showTools) },
		{ label: 'Model calls', on: showModelCalls, flip: () => (showModelCalls = !showModelCalls) },
		{ label: 'Connectors', on: showConnectors, flip: () => (showConnectors = !showConnectors) },
		{ label: 'Worktrees', on: showWorktrees, flip: () => (showWorktrees = !showWorktrees) }
	]);

	function load(text: string, name: string) {
		source = name;
		parseError = '';
		result = null;
		selectedSpanId = null;
		highlightedWorktreeId = null;
		try {
			result = validateTrace(JSON.parse(text));
		} catch (e) {
			parseError = e instanceof Error ? e.message : String(e);
		}
	}

	async function onFile(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		if (file) load(await file.text(), file.name);
	}

	// Drag-and-drop uses the same validation path as the file picker.
	async function onDrop(e: DragEvent) {
		e.preventDefault();
		dragging = false;
		const file = e.dataTransfer?.files?.[0];
		if (file) load(await file.text(), file.name);
	}

	function exportSvg() {
		if (!timeline || !result?.ok) return;
		exportError = '';
		try {
			const svg = timeline.exportSvg();
			const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
			const a = document.createElement('a');
			a.href = url;
			a.download = `${result.value.trace.id}.svg`;
			document.body.append(a);
			a.click();
			a.remove();
			setTimeout(() => URL.revokeObjectURL(url), 1000);
		} catch (e) {
			exportError = e instanceof Error ? e.message : String(e);
		}
	}

	onMount(async () => {
		// Same-origin static asset; no external network.
		try {
			const res = await fetch('sample-trace.json');
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			load(await res.text(), 'sample-trace.json');
		} catch (e) {
			// Leave the page usable: the file picker and drag-and-drop still work.
			sampleError = `Couldn't load the bundled sample (${e instanceof Error ? e.message : String(e)}). Open a trace file instead.`;
		}
	});
</script>

<svelte:window
	ondragover={(e) => {
		e.preventDefault();
		dragging = true;
	}}
	ondragleave={(e) => {
		if (!e.relatedTarget) dragging = false;
	}}
	ondrop={onDrop}
/>

<div class="page">
	<header class="head">
		<div class="titles">
			<h1>{result?.ok ? (result.value.trace.title ?? result.value.trace.id) : 'Work Trace'}</h1>
			<p class="meta">
				{#if result?.ok}
					<span>{source}</span><span>{result.value.spans.length} spans</span><span
						>{result.value.agentSessions.length} sessions</span
					><span>{result.value.events.length} events</span><span
						>{result.value.worktrees.length} worktrees</span
					><span>{(result.value.trace.observedUntilMs / 1000).toFixed(0)}s observed</span>
				{:else}
					<span>{source || 'No trace loaded'}</span>
				{/if}
			</p>
		</div>
		<div class="open">
			<label class="btn">
				Open JSON
				<input class="sr" type="file" accept="application/json,.json" onchange={onFile} />
			</label>
			<span class="hint">or drop a .json file on this page</span>
		</div>
	</header>

	<div class="controls">
		<div class="seg" role="group" aria-label="Show">
			{#each toggles as t (t.label)}
				<button type="button" aria-pressed={t.on} class:on={t.on} onclick={t.flip}>{t.label}</button>
			{/each}
		</div>
		<label class="select">
			<span>Highlight worktree</span>
			<select bind:value={highlightedWorktreeId} disabled={!result?.ok}>
				<option value={null}>None</option>
				{#if result?.ok}
					{#each result.value.worktrees as wt (wt.id)}
						<option value={wt.id}>{wt.label ?? wt.id}</option>
					{/each}
				{/if}
			</select>
		</label>
		<span class="grow"></span>
		<button type="button" class="btn primary" onclick={exportSvg} disabled={!result?.ok}>Export SVG</button>
	</div>
	{#if exportError}<p class="bad">Export failed: {exportError}</p>{/if}

	{#if dragging}<div class="drop-overlay">Drop a trace JSON file to open it</div>{/if}

	{#if sampleError && !result}
		<p class="bad">{sampleError}</p>
	{/if}
	{#if parseError}
		<p class="bad">JSON parse error: {parseError}</p>
	{:else if result?.ok}
		<WorkTimeline
			bind:this={timeline}
			trace={result.value}
			{showTools}
			{showModelCalls}
			{showConnectors}
			{showWorktrees}
			{selectedSpanId}
			{highlightedWorktreeId}
			onWorktreeSelect={(id) => (highlightedWorktreeId = id)}
			onSpanSelect={(id) => (selectedSpanId = id)}
			onEventSelect={(id) => (selectedEventId = id)}
		/>
		<p class="selection">
			Selected span <code data-testid="selected-span">{selectedSpanId ?? '—'}</code> · event
			<code data-testid="selected-event">{selectedEventId ?? '—'}</code>
		</p>
	{:else if result}
		<div class="card issues">
			<p class="bad">Invalid trace ({result.issues.length} issues):</p>
			<ul>
				{#each result.issues as issue, i (i)}
					<li><code>{issue.path}</code> {issue.message}</li>
				{/each}
			</ul>
		</div>
	{/if}
</div>

<style>
	:global(body) {
		margin: 0;
		background: #f6f7f9;
		color: #1f2430;
		font-family: Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
		-webkit-font-smoothing: antialiased;
	}
	.page {
		max-width: 1600px;
		margin: 0 auto;
		padding: 20px 24px 32px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 16px;
		flex-wrap: wrap;
	}
	h1 {
		margin: 0;
		font-size: 18px;
		font-weight: 650;
		letter-spacing: -0.01em;
		line-height: 1.3;
	}
	.meta {
		margin: 3px 0 0;
		display: flex;
		flex-wrap: wrap;
		gap: 2px 0;
		font-size: 12px;
		color: #6b7280;
	}
	.meta span + span::before {
		content: '·';
		margin: 0 7px;
		color: #b4bac4;
	}
	.open {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.hint {
		font-size: 12px;
		color: #8a919e;
	}
	.btn {
		font: inherit;
		font-size: 12.5px;
		font-weight: 500;
		height: 30px;
		padding: 0 12px;
		display: inline-flex;
		align-items: center;
		border: 1px solid #d9dce3;
		border-radius: 7px;
		background: #fff;
		color: #2a303c;
		cursor: pointer;
		box-sizing: border-box;
	}
	.btn:hover:not(:disabled) {
		background: #f3f4f6;
	}
	.btn:focus-within,
	.btn:focus-visible {
		outline: 2px solid #2f5fd0;
		outline-offset: 1px;
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.btn.primary {
		background: #2f5fd0;
		border-color: #2f5fd0;
		color: #fff;
	}
	.btn.primary:hover:not(:disabled) {
		background: #2753b8;
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
		overflow: hidden;
	}
	.controls {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 10px 16px;
	}
	.grow {
		flex: 1;
	}
	.seg {
		display: inline-flex;
		border: 1px solid #d9dce3;
		border-radius: 7px;
		overflow: hidden;
		background: #fff;
	}
	.seg button {
		font: inherit;
		font-size: 12.5px;
		font-weight: 500;
		height: 28px;
		padding: 0 13px;
		border: 0;
		border-left: 1px solid #d9dce3;
		background: #fff;
		color: #5b6372;
		cursor: pointer;
	}
	.seg button:first-child {
		border-left: 0;
	}
	.seg button:hover {
		background: #f6f7f9;
	}
	.seg button.on {
		background: #eaf0fd;
		color: #2447a3;
	}
	.seg button:focus-visible {
		outline: 2px solid #2f5fd0;
		outline-offset: -2px;
	}
	.select {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 12.5px;
		color: #6b7280;
	}
	.select select {
		font: inherit;
		font-size: 12.5px;
		height: 30px;
		padding: 0 26px 0 10px;
		border: 1px solid #d9dce3;
		border-radius: 7px;
		background: #fff;
		color: #2a303c;
	}
	.select select:disabled {
		opacity: 0.5;
	}
	.selection {
		margin: 0;
		font-size: 11.5px;
		color: #8a919e;
	}
	.card {
		background: #fff;
		border: 1px solid #e6e8ec;
		border-radius: 10px;
		padding: 12px 16px;
	}
	.drop-overlay {
		position: fixed;
		inset: 0;
		display: grid;
		place-items: center;
		background: rgba(47, 95, 208, 0.1);
		border: 3px dashed #2f5fd0;
		font-size: 1.4rem;
		color: #1e3a8a;
		pointer-events: none;
		z-index: 10;
	}
	.bad {
		color: #b91c1c;
		margin: 0;
		font-size: 13px;
	}
</style>
