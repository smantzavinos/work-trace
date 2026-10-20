// Browser-side static SVG export. Renders the same TimelineSvg component the screen uses
// (one scene/geometry pipeline) into a detached element at a fit-all transform, serializes it,
// and unmounts. Requires a DOM (document + XMLSerializer); not usable during SSR.
import { flushSync, mount, unmount } from 'svelte';
import TimelineSvg from '../components/TimelineSvg.svelte';
import { computeLayout } from '../layout/compute-layout.js';
import { fitPxPerMs } from '../layout/geometry.js';
import { stepsOnlyCollapse } from '../layout/selection.js';
import { buildIndex } from '../model/indexes.js';
import type { WorkTrace } from '../model/types.js';

export interface ExportOptions {
	/** Default false. */
	showTools?: boolean;
	/** Default false. */
	showModelCalls?: boolean;
	/** Causal connectors. Default true. */
	showConnectors?: boolean;
	/** Draw worktree regions. Default true. */
	showWorktrees?: boolean;
	collapsedSpanIds?: ReadonlySet<string> | readonly string[];
	/** "Steps only": also collapse every work item span that has children. Default false. */
	compactWorkItems?: boolean;
	hiddenAgentTypes?: ReadonlySet<string> | readonly string[];
	/** Emphasize this worktree (region and bars) and dim the rest. */
	highlightedWorktreeId?: string | null;
	/** Opt-in (default none): emphasizes the selected lineage, shows its resume links, dims the rest. */
	selectedSpanId?: string | null;
	/** Output width in px. Default 1600. */
	width?: number;
}

/**
 * Serialize the trace as a standalone, non-interactive SVG document string, fit horizontally to
 * [0, observedUntilMs] regardless of any interactive zoom/pan. Contains title/desc, a header,
 * embedded style and a legend, no scripts, handlers, foreignObject or external references.
 */
export function exportTimelineSvg(trace: WorkTrace, options: ExportOptions = {}): string {
	if (typeof document === 'undefined' || typeof XMLSerializer === 'undefined')
		throw new Error('exportTimelineSvg requires a browser DOM');
	const width = Math.max(320, Math.round(options.width ?? 1600));
	const scene = computeLayout(trace, {
		showTools: options.showTools ?? false,
		showModelCalls: options.showModelCalls ?? false,
		collapsedSpanIds: new Set([
			...(options.collapsedSpanIds ?? []),
			...(options.compactWorkItems ? stepsOnlyCollapse(buildIndex(trace)) : [])
		]),
		hiddenAgentTypes: new Set(options.hiddenAgentTypes ?? [])
	});
	const target = document.createElement('div');
	const app = mount(TimelineSvg, {
		target,
		props: {
			scene,
			width,
			pxPerMs: fitPxPerMs(width, trace.trace.observedUntilMs),
			viewStartMs: 0,
			selectedSpanId: options.selectedSpanId ?? null,
			showConnectors: options.showConnectors ?? true,
			showWorktrees: options.showWorktrees ?? true,
			highlightedWorktreeId: options.highlightedWorktreeId ?? null,
			title: trace.trace.title ?? trace.trace.id,
			exportMode: true
		}
	});
	try {
		flushSync();
		const svg = target.querySelector('svg');
		if (!svg) throw new Error('export failed: no svg rendered');
		// Drop Svelte's anchor comments.
		const walker = document.createTreeWalker(svg, NodeFilter.SHOW_COMMENT);
		const comments: Node[] = [];
		while (walker.nextNode()) comments.push(walker.currentNode);
		for (const c of comments) c.parentNode?.removeChild(c);
		return new XMLSerializer().serializeToString(svg);
	} finally {
		void unmount(app);
	}
}
