// Deterministic palette: agent type -> fill by its position in scene.agentTypes.
// Calm, slightly desaturated mid-dark fills; every one keeps >= 4.5:1 contrast with white text.
export interface BarColor {
	fill: string;
	text: string;
	/** 1px inner border for light (tool / model) bars; undefined for solid agent bars */
	border?: string;
	/** light fill: status overlays and ticks use dark ink instead of white */
	neutral: boolean;
}

export const ACCENT = '#2f5fd0';
export const ERROR = '#d92d3a';

const PALETTE = [
	'#3f62c0', // slate blue
	'#2f7d6d', // teal
	'#7a5cb8', // muted violet
	'#a15c33', // clay
	'#b04a78', // dusty rose
	'#2a7490', // steel
	'#557a28', // olive
	'#586174' // slate
];

/** Work item hues (bands, titles, step badges): distinct from the agent fills, used as tints. */
const WORK_PALETTE = ['#c2410c', '#0e7490', '#7e22ce', '#4d7c0f', '#be185d', '#1d4ed8', '#a16207', '#0f766e'];

/** Colour of a work item by its position in scene.workItems (first-step order). */
export function workItemColor(workItemIds: readonly string[], id: string): string {
	const i = workItemIds.indexOf(id);
	return i < 0 ? '#586174' : WORK_PALETTE[i % WORK_PALETTE.length];
}

export const TOOL_COLOR: BarColor = { fill: '#f0f2f5', text: '#3a4252', border: '#d3d8e0', neutral: true };
export const MODEL_COLOR: BarColor = { fill: '#f1eefa', text: '#483d82', border: '#d8d0f0', neutral: true };
const FALLBACK: BarColor = { fill: '#6b7280', text: '#ffffff', neutral: false };

export function agentTypeColor(agentTypes: readonly string[], type: string | undefined): BarColor {
	const i = type === undefined ? -1 : agentTypes.indexOf(type);
	if (i < 0) return FALLBACK;
	return { fill: PALETTE[i % PALETTE.length], text: '#ffffff', neutral: false };
}

export function barColor(
	agentTypes: readonly string[],
	kind: 'agent' | 'tool' | 'model',
	type: string | undefined
): BarColor {
	if (kind === 'tool') return TOOL_COLOR;
	if (kind === 'model') return MODEL_COLOR;
	return agentTypeColor(agentTypes, type);
}
