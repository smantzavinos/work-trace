import type { WorkTrace } from '../model/types.js';

export interface WorkTimelineProps {
	/** Previously validated schema v3 trace. */
	trace: WorkTrace;
	/** When supplied (even null) selection is controlled by the host. */
	selectedSpanId?: string | null;
	onSpanSelect?: (spanId: string | null) => void;
	onEventSelect?: (eventId: string | null) => void;
	/** Default false. */
	showTools?: boolean;
	/** Default false. */
	showModelCalls?: boolean;
	/** Agent types whose bars are hidden (descendants re-attach visually). */
	hiddenAgentTypes?: readonly string[];
	/** When supplied (even null) worktree highlight is controlled by the host. */
	highlightedWorktreeId?: string | null;
	onWorktreeSelect?: (worktreeId: string | null) => void;
	/** Causal connectors between parent and child bars. Default true. */
	showConnectors?: boolean;
	/** Draw each non-base worktree as a labelled region behind the bars. Default true. */
	showWorktrees?: boolean;
}
