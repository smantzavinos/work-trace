// Public package surface. Everything else is internal.
export type {
	WorkTrace,
	AgentSession,
	AgentSpan,
	CallSpan,
	WorkSpan,
	WorkEvent,
	CompactionEvent,
	Repository,
	Worktree,
	WorktreeRefInterval,
	GitRef,
	Attributes,
	ValidationIssue,
	ValidationResult
} from './model/types.js';
export { default as WorkTimeline } from './components/WorkTimeline.svelte';
export type { WorkTimelineProps } from './components/types.js';
export { exportTimelineSvg } from './export/export-svg.js';
export type { ExportOptions } from './export/export-svg.js';
export { validateTrace } from './model/validate.js';
