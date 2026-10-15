<script lang="ts">
	import type { TimelineScene } from '../layout/compute-layout.js';
	import { ancestorsOf, formatRef, refAt } from '../model/indexes.js';
	import type { Attributes, WorkSpan, GitRef } from '../model/types.js';
	import { formatSeconds } from '../layout/time.js';
	import { sessionIdOf, spanLabel } from '../layout/selection.js';

	interface Props {
		scene: TimelineScene;
		selectedSpanId: string | null;
		selectedEventId: string | null;
		collapsed: ReadonlySet<string>;
		/** select a span and bring it into view */
		onNavigate: (id: string) => void;
		onSelectEvent: (id: string) => void;
		onToggleCollapse: (id: string) => void;
	}

	let {
		scene,
		selectedSpanId,
		selectedEventId,
		collapsed,
		onNavigate,
		onSelectEvent,
		onToggleCollapse
	}: Props = $props();

	const index = $derived(scene.index);
	const until = $derived(index.trace.trace.observedUntilMs);
	const span = $derived(selectedSpanId ? index.spans.get(selectedSpanId) : undefined);
	const event = $derived(
		!span && selectedEventId ? index.events.get(selectedEventId) : undefined
	);

	const endOf = (s: WorkSpan) => s.endMs ?? until;
	const sessionOf = (id: string) => {
		const sid = sessionIdOf(index, id);
		return sid ? index.sessions.get(sid) : undefined;
	};

	const info = $derived.by(() => {
		if (!span) return undefined;
		const session = sessionOf(span.id);
		const ancestors = ancestorsOf(index, span.id).reverse();
		const parent = span.parentId ? index.spans.get(span.parentId) : undefined;
		const siblings = span.kind === 'agent' ? (index.sessionSpans.get(span.sessionId) ?? []) : [];
		const pos = siblings.findIndex((s) => s.id === span.id);
		const wt = span.worktreeId ? index.worktrees.get(span.worktreeId) : undefined;
		const repo = wt ? index.repositories.get(wt.repositoryId) : undefined;
		const refs = span.worktreeId ? (index.worktreeRefs.get(span.worktreeId) ?? []) : [];
		const end = endOf(span);
		const transitions: { at: number; from?: GitRef; to?: GitRef }[] = [];
		const times = new Set<number>();
		for (const r of refs)
			for (const t of [r.startMs, r.endMs]) if (t > span.startMs && t < end) times.add(t);
		for (const t of [...times].sort((a, b) => a - b))
			transitions.push({
				at: t,
				from: refs.find((r) => r.endMs === t)?.ref,
				to: refs.find((r) => r.startMs === t)?.ref
			});
		return {
			session,
			ancestors,
			parent,
			children: index.children.get(span.id) ?? [],
			prev: pos > 0 ? siblings[pos - 1] : undefined,
			next: pos >= 0 && pos < siblings.length - 1 ? siblings[pos + 1] : undefined,
			activation: pos >= 0 ? `${pos + 1} of ${siblings.length}` : undefined,
			wt,
			repo,
			startRef: span.worktreeId ? refAt(index, span.worktreeId, span.startMs) : undefined,
			transitions,
			events: scene.positionedEvents.filter((p) => p.anchorSpanId === span.id),
			end
		};
	});

	const eventInfo = $derived.by(() => {
		if (!event) return undefined;
		const pos = scene.positionedEvents.find((p) => p.eventId === event.id);
		const anchor = pos?.anchorSpanId ? index.spans.get(pos.anchorSpanId) : undefined;
		return { pos, anchor, session: index.sessions.get(event.sessionId) };
	});

	const attrs = (a: Attributes | undefined) => Object.entries(a ?? {});
	const refText = (r: GitRef | undefined) => formatRef(r);
	const dash = (n: number | undefined) => (n === undefined ? '—' : String(n));
	const STATUS: Record<string, string> = { ok: '#2f9e6e', error: '#d92d3a', cancelled: '#8b93a1', running: '#2f5fd0' };
</script>

{#snippet spanLink(s: WorkSpan)}
	<button type="button" class="link" onclick={() => onNavigate(s.id)} title={s.id}
		>{spanLabel(index, s)}</button
	>
{/snippet}

{#snippet attrTable(a: Attributes | undefined)}
	{#if attrs(a).length}
		<table class="attrs">
			<tbody>
				{#each attrs(a) as [k, v] (k)}
					<tr><th scope="row">{k}</th><td>{String(v)}</td></tr>
				{/each}
			</tbody>
		</table>
	{:else}
		<span class="muted">none</span>
	{/if}
{/snippet}

<aside class="details" aria-label="Details">
	{#if span && info}
		<header>
			<div class="kicker">{span.kind}{info.session ? ` · ${info.session.agentType}` : ''}</div>
			<h3>{spanLabel(index, span)}</h3>
			<div class="meta">
				<span class="pill"><i style:background={STATUS[span.status]}></i>{span.status}</span>
				<span class="muted">{formatSeconds(info.end - span.startMs)}{span.endMs === undefined ? ' so far' : ''}</span>
				<code class="id">{span.id}</code>
			</div>
		</header>
		<section>
			<h4>Timing</h4>
			<dl>
				<dt>Start</dt>
				<dd>{formatSeconds(span.startMs)}</dd>
				<dt>End</dt>
				<dd>{span.endMs === undefined ? `running (observed until ${formatSeconds(until)})` : formatSeconds(span.endMs)}</dd>
				<dt>Duration</dt>
				<dd>{formatSeconds(info.end - span.startMs)}{span.endMs === undefined ? ' (so far)' : ''}</dd>
			</dl>
		</section>
		<section>
			<h4>Session</h4>
			<dl>
				<dt>Label</dt>
				<dd>{span.label ?? '—'}</dd>
				<dt>Agent type</dt>
				<dd>{info.session?.agentType ?? '—'}</dd>
				<dt>Session</dt>
				<dd>
					{#if info.session}<code>{info.session.id}</code>{info.session.label
							? ` — ${info.session.label}`
							: ''}{:else}—{/if}
				</dd>
				<dt>Mode</dt>
				<dd>{span.kind === 'agent' ? span.mode : '—'}</dd>
				{#if span.kind === 'agent'}
					<dt>Activation</dt>
					<dd>{info.activation ?? '—'}</dd>
					<dt>Previous</dt>
					<dd>{#if info.prev}{@render spanLink(info.prev)}{:else}—{/if}</dd>
					<dt>Next</dt>
					<dd>{#if info.next}{@render spanLink(info.next)}{:else}—{/if}</dd>
				{/if}
			</dl>
		</section>
		<section>
			<h4>Lineage</h4>
			<dl>
				<dt>Parent</dt>
				<dd>{#if info.parent}{@render spanLink(info.parent)}{:else}— (root){/if}</dd>
				<dt>Path</dt>
				<dd>
					{#each info.ancestors as a, i (a.id)}
						{#if i > 0}<span class="muted sepc">›</span>{/if}{@render spanLink(a)}
					{/each}
					{#if info.ancestors.length}<span class="muted sepc">›</span>{/if}<strong>{spanLabel(index, span)}</strong>
				</dd>
				<dt>Children</dt>
				<dd>
					{#if info.children.length}
						<ul class="plain">
							{#each info.children as c (c.id)}<li>{@render spanLink(c)}</li>{/each}
						</ul>
						<button type="button" class="btn" onclick={() => onToggleCollapse(span.id)}>
							{collapsed.has(span.id) ? 'Expand children' : 'Collapse children'}
						</button>
					{:else}—{/if}
				</dd>
				<dt>Compactions</dt>
				<dd>
					{#if info.events.length}
						<ul class="plain">
							{#each info.events as p (p.eventId)}
								<li>
									<button type="button" class="link" onclick={() => onSelectEvent(p.eventId)}
										>{index.events.get(p.eventId)?.label ?? p.eventId}</button
									>
									<span class="muted">@ {formatSeconds(p.atMs)}</span>
								</li>
							{/each}
						</ul>
					{:else}—{/if}
				</dd>
			</dl>
		</section>
		<section>
			<h4>Git</h4>
			<dl>
				<dt>Worktree</dt>
				<dd>
					{#if info.wt}
						{info.wt.label ?? info.wt.id}
						<div class="muted">{info.repo?.label ?? info.wt.repositoryId}</div>
						<div class="muted">{info.wt.path ?? 'Path unknown'}</div>
					{:else}Unknown{/if}
				</dd>
				<dt>Ref at start</dt>
				<dd>{span.worktreeId ? refText(info.startRef) : 'Unknown'}</dd>
				<dt>Ref changes</dt>
				<dd>
					{#if info.transitions.length}
						<ul class="plain">
							{#each info.transitions as t (t.at)}
								<li>{formatSeconds(t.at)}: {refText(t.from)} → {refText(t.to)}</li>
							{/each}
						</ul>
					{:else}—{/if}
				</dd>
			</dl>
		</section>
		<section>
			<h4>Attributes</h4>
			{@render attrTable(span.attributes)}
		</section>
	{:else if event && eventInfo}
		<header>
			<div class="kicker">{event.kind}</div>
			<h3>{event.label ?? 'Compaction'}</h3>
			<div class="meta">
				<span class="pill"><i style:background={event.outcome === 'error' ? STATUS.error : event.outcome === 'ok' ? STATUS.ok : STATUS.cancelled}></i>{event.outcome ?? 'unknown'}</span>
				<span class="muted">{event.endMs === undefined ? 'duration unknown' : formatSeconds(event.endMs - event.atMs)}</span>
				<code class="id">{event.id}</code>
			</div>
		</header>
		<section>
			<h4>Event</h4>
			<dl>
				<dt>Session</dt>
				<dd>
					<code>{event.sessionId}</code>{eventInfo.session?.label ? ` — ${eventInfo.session.label}` : ''}
				</dd>
				<dt>Anchor run</dt>
				<dd>
					{#if eventInfo.anchor}
						{@render spanLink(eventInfo.anchor)}
						<span class="muted">({eventInfo.pos?.explicitAnchor ? 'explicit' : 'inferred'})</span>
					{:else}not attached to an active run{/if}
				</dd>
				<dt>At</dt>
				<dd>{formatSeconds(event.atMs)}</dd>
				<dt>End</dt>
				<dd>{event.endMs === undefined ? '—' : formatSeconds(event.endMs)}</dd>
				<dt>Trigger</dt>
				<dd>{event.trigger ?? '—'}</dd>
				<dt>Outcome</dt>
				<dd>{event.outcome ?? '—'}</dd>
				<dt>Tokens before</dt>
				<dd>{dash(event.tokensBefore)}</dd>
				<dt>Tokens after</dt>
				<dd>{dash(event.tokensAfter)}</dd>
			</dl>
		</section>
		<section>
			<h4>Attributes</h4>
			{@render attrTable(event.attributes)}
		</section>
	{:else}
		<p class="empty">Select a span or event to see its details.</p>
	{/if}
</aside>

<style>
	.details {
		font-size: 12.5px;
		line-height: 1.45;
		color: #1f2430;
		min-width: 0;
	}
	header {
		padding-bottom: 12px;
	}
	.kicker {
		font-size: 10.5px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #8a919e;
		font-weight: 600;
	}
	h3 {
		margin: 2px 0 8px;
		font-size: 15px;
		font-weight: 600;
		line-height: 1.3;
		overflow-wrap: anywhere;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 10px;
		font-size: 12px;
	}
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 1px 8px 1px 7px;
		border: 1px solid #e1e4ea;
		border-radius: 999px;
		font-weight: 500;
		background: #fafbfc;
	}
	.pill i {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		display: inline-block;
	}
	.id {
		color: #8a919e;
		font-size: 11px;
		overflow-wrap: anywhere;
	}
	section {
		border-top: 1px solid #eceef2;
		padding: 11px 0 12px;
	}
	h4 {
		margin: 0 0 7px;
		font-size: 10.5px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #8a919e;
	}
	dl {
		margin: 0;
		display: grid;
		grid-template-columns: 5.75rem minmax(0, 1fr);
		gap: 5px 10px;
	}
	dt {
		color: #6b7280;
	}
	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}
	code {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 11.5px;
	}
	.muted {
		color: #6b7280;
	}
	.sepc {
		margin: 0 5px;
	}
	.empty {
		margin: 0;
		padding: 28px 8px;
		text-align: center;
		color: #8a919e;
	}
	.plain {
		list-style: none;
		margin: 0 0 4px;
		padding: 0;
	}
	.link {
		all: unset;
		color: #2f5fd0;
		cursor: pointer;
		overflow-wrap: anywhere;
	}
	.link:hover {
		text-decoration: underline;
	}
	.link:focus-visible,
	.btn:focus-visible {
		outline: 2px solid #2f5fd0;
		outline-offset: 1px;
		border-radius: 3px;
	}
	.btn {
		font: inherit;
		font-size: 12px;
		padding: 2px 9px;
		cursor: pointer;
		background: #fff;
		border: 1px solid #d9dce3;
		border-radius: 6px;
		color: #3a4252;
	}
	.btn:hover {
		background: #f3f4f6;
	}
	.attrs {
		border-collapse: collapse;
		width: 100%;
	}
	.attrs th,
	.attrs td {
		text-align: left;
		padding: 3px 8px 3px 0;
		vertical-align: top;
		font-weight: normal;
		border-bottom: 1px solid #f0f1f4;
	}
	.attrs tr:last-child th,
	.attrs tr:last-child td {
		border-bottom: 0;
	}
	.attrs th {
		color: #6b7280;
		width: 5.75rem;
	}
</style>
