// Legend model shared by the HTML legend and the one embedded in exported SVGs. Pure.
// Only entries that actually occur in the scene are listed.
import { agentTypeColor } from './colors.js';
import type { TimelineScene } from './compute-layout.js';
import { formatRef, refAt } from '../model/indexes.js';
import { measureText } from './text.js';
import { worktreeInfoMap } from './worktrees.js';

export type LegendKind =
	| 'type'
	| 'tool'
	| 'model'
	| 'error'
	| 'cancelled'
	| 'running'
	| 'resume'
	| 'compaction'
	| 'refswitch'
	| 'base'
	| 'worktree';

export interface LegendEntry {
	kind: LegendKind;
	text: string;
	/** quieter trailing text */
	note?: string;
	/** agent-type name or worktree id */
	ref?: string;
	/** swatch fill (type) or worktree colour */
	color?: string;
}

export interface LegendGroup {
	title: string;
	entries: LegendEntry[];
}

/**
 * Legend rows in display order: Agents, Calls, Status, Sessions, Git. Empty groups are dropped,
 * so a trace without e.g. errors or worktrees gets a shorter legend.
 */
export function legendGroups(scene: TimelineScene, showWorktrees: boolean): LegendGroup[] {
	const items = scene.items;
	const usedTypes = new Set(
		items.flatMap((i) => (i.span.kind === 'agent' && i.agentType ? [i.agentType] : []))
	);
	const has = (f: (i: (typeof items)[number]) => boolean) => items.some(f);

	const agents: LegendEntry[] = scene.agentTypes
		.filter((t) => usedTypes.has(t))
		.map((t) => ({ kind: 'type' as const, text: t, ref: t, color: agentTypeColor(scene.agentTypes, t).fill }));

	const calls: LegendEntry[] = [];
	if (has((i) => i.span.kind === 'tool')) calls.push({ kind: 'tool', text: 'tool' });
	if (has((i) => i.span.kind === 'model')) calls.push({ kind: 'model', text: 'model call' });

	const status: LegendEntry[] = [];
	if (has((i) => i.span.status === 'error')) status.push({ kind: 'error', text: 'error' });
	if (has((i) => i.span.status === 'cancelled')) status.push({ kind: 'cancelled', text: 'cancelled' });
	if (has((i) => i.span.status === 'running')) status.push({ kind: 'running', text: 'running' });

	const sessions: LegendEntry[] = [];
	if (has((i) => i.span.kind === 'agent' && i.span.mode === 'resume'))
		sessions.push({ kind: 'resume', text: 'paused, then resumed', note: '2/3 = run 2 of 3' });
	if (scene.positionedEvents.length) sessions.push({ kind: 'compaction', text: 'context compaction' });

	const git: LegendEntry[] = [];
	if (showWorktrees) {
		const infos = worktreeInfoMap(scene.index, scene.baseWorktreeId);
		const base = scene.baseWorktreeId ? infos.get(scene.baseWorktreeId) : undefined;
		if (base) {
			const root = scene.items.find((i) => i.span.worktreeId === base.id);
			const ref = root ? formatRef(refAt(scene.index, base.id, root.startMs)) : undefined;
			git.push({
				kind: 'base',
				text: base.label,
				note: ref && ref !== 'Unknown' ? `base · ${ref}` : 'base',
				ref: base.id,
				color: base.color
			});
		}
		const seen = new Set<string>();
		for (const r of scene.worktreeRegions) {
			if (seen.has(r.worktreeId) || r.worktreeId === scene.baseWorktreeId) continue;
			seen.add(r.worktreeId);
			const info = infos.get(r.worktreeId);
			if (info) git.push({ kind: 'worktree', text: info.label, ref: info.id, color: info.color });
		}
	}
	if (has((i) => i.refTicksMs.length > 0)) git.push({ kind: 'refswitch', text: 'branch switch' });

	return [
		{ title: 'Agents', entries: agents },
		{ title: 'Calls', entries: calls },
		{ title: 'Status', entries: status },
		{ title: 'Sessions', entries: sessions },
		{ title: 'Git', entries: git }
	].filter((g) => g.entries.length > 0);
}

export interface PlacedLegendEntry extends LegendEntry {
	x: number;
	y: number;
}

export interface PlacedLegendTitle {
	text: string;
	y: number;
}

export const LEGEND = {
	rowH: 22,
	swatchW: 18,
	swatchGap: 6,
	gap: 18,
	pad: 16,
	top: 12,
	font: 11,
	/** width of the group-title column */
	titleW: 72
} as const;

const entryWidth = (e: LegendEntry) =>
	LEGEND.swatchW +
	LEGEND.swatchGap +
	measureText(e.text, LEGEND.font, 500) +
	(e.note ? 5 + measureText(e.note, LEGEND.font) : 0);

/** One row per group (title column + entries), wrapping long groups within `width`. */
export function computeLegend(
	scene: TimelineScene,
	width: number,
	showWorktrees: boolean
): { items: PlacedLegendEntry[]; titles: PlacedLegendTitle[]; height: number } {
	const items: PlacedLegendEntry[] = [];
	const titles: PlacedLegendTitle[] = [];
	const x0 = LEGEND.pad + LEGEND.titleW;
	const maxX = width - LEGEND.pad;
	let y = LEGEND.top - LEGEND.rowH;
	for (const group of legendGroups(scene, showWorktrees)) {
		y += LEGEND.rowH;
		titles.push({ text: group.title, y });
		let x = x0;
		for (const e of group.entries) {
			const w = entryWidth(e);
			if (x > x0 && x + w > maxX) {
				x = x0;
				y += LEGEND.rowH;
			}
			items.push({ ...e, x, y });
			x += w + LEGEND.gap;
		}
	}
	return { items, titles, height: titles.length ? y + LEGEND.rowH + 4 : 0 };
}
