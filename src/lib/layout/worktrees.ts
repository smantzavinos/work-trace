// Worktree presentation helpers (colour, legend data). Pure.
import type { TraceIndex } from '../model/indexes.js';

// Muted hues that stay distinct from the agent-type fills and from the error red.
// Only ever used as light tints / hairlines / chip text, never as bar fills.
const WT_PALETTE: { color: string; ink: string }[] = [
	{ color: '#d08a1e', ink: '#8a5a0c' }, // amber
	{ color: '#1f9bb8', ink: '#0e6178' }, // cyan
	{ color: '#b05fbf', ink: '#7a3a89' }, // orchid
	{ color: '#7aa32a', ink: '#4d6c13' }, // lime
	{ color: '#3aa889', ink: '#1f6e58' }, // jade
	{ color: '#8a7be0', ink: '#5446ad' }, // periwinkle
	{ color: '#d9607a', ink: '#9d3350' }, // pink
	{ color: '#9a9488', ink: '#625d52' } // stone
];
/** The base checkout is the unboxed backdrop; it gets a neutral colour. */
const BASE_WT = { color: '#8b93a1', ink: '#4b5361' };

export interface WorktreeInfo {
	id: string;
	label: string;
	repositoryId: string;
	repositoryLabel: string;
	color: string;
	/** darker variant for text */
	ink: string;
}

/**
 * Worktree id -> info. Colours follow the sorted id order (skipping the base worktree, which is
 * neutral), so they are stable per trace.
 */
export function worktreeInfoMap(index: TraceIndex, baseId?: string): Map<string, WorktreeInfo> {
	const ids = [...index.worktrees.keys()].sort();
	const map = new Map<string, WorktreeInfo>();
	let n = 0;
	for (const id of ids) {
		const wt = index.worktrees.get(id)!;
		const c = id === baseId ? BASE_WT : WT_PALETTE[n++ % WT_PALETTE.length];
		map.set(id, {
			id,
			label: wt.label ?? wt.id,
			repositoryId: wt.repositoryId,
			repositoryLabel: index.repositories.get(wt.repositoryId)?.label ?? wt.repositoryId,
			color: c.color,
			ink: c.ink
		});
	}
	return map;
}
