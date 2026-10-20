<script lang="ts">
	import { ERROR, MODEL_COLOR, TOOL_COLOR } from '../layout/colors.js';
	import type { LegendKind } from '../layout/legend.js';

	interface Props {
		kind: LegendKind;
		/** type fill or worktree colour */
		color?: string;
		/** unique id prefix for gradients / patterns inside this swatch */
		uid: string;
	}
	let { kind, color = '#8b93a1', uid }: Props = $props();
	const GREY = '#9aa3b2';
</script>

<!-- 18 x 14 box -->
{#if kind === 'type'}
	<rect x="0" y="2" width="18" height="10" rx="3" fill={color} />
{:else if kind === 'tool'}
	<rect x="0.5" y="2.5" width="17" height="9" rx="3" fill={TOOL_COLOR.fill} stroke={TOOL_COLOR.border} />
{:else if kind === 'model'}
	<rect x="0.5" y="2.5" width="17" height="9" rx="3" fill={MODEL_COLOR.fill} stroke={MODEL_COLOR.border} />
{:else if kind === 'error'}
	<rect x="0" y="2" width="18" height="10" rx="3" fill={GREY} />
	<rect x="1" y="3" width="16" height="8" rx="2" fill="none" stroke={ERROR} stroke-width="2" />
{:else if kind === 'cancelled'}
	<defs>
		<pattern id="{uid}-h" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
			<line x1="0" y1="0" x2="0" y2="5" stroke="#ffffff" stroke-opacity="0.5" stroke-width="2" />
		</pattern>
	</defs>
	<rect x="0" y="2" width="18" height="10" rx="3" fill={GREY} />
	<rect x="0" y="2" width="18" height="10" rx="3" fill="url(#{uid}-h)" />
{:else if kind === 'running'}
	<defs>
		<linearGradient id="{uid}-g" x1="0" x2="1" y1="0" y2="0">
			<stop offset="0.3" stop-color={GREY} />
			<stop offset="1" stop-color={GREY} stop-opacity="0.1" />
		</linearGradient>
	</defs>
	<rect x="0" y="2" width="18" height="10" rx="3" fill="url(#{uid}-g)" />
{:else if kind === 'resume'}
	<!-- run that continues (chevron point) · dotted pause · resumed run (matching notch) -->
	<path d="M0 3H3L5.5 7L3 11H0Z" fill={GREY} />
	<path d="M6.5 7H11.5" stroke={GREY} stroke-width="1.25" stroke-dasharray="1 2" stroke-linecap="round" />
	<path d="M12.5 3H18V11H12.5L15 7Z" fill={GREY} />
{:else if kind === 'compaction'}
	<path d="M9 2L14 7L9 12L4 7Z" fill="#ffffff" stroke="#1f2430" stroke-width="1.25" stroke-linejoin="round" />
{:else if kind === 'refswitch'}
	<rect x="0" y="2" width="18" height="10" rx="3" fill={GREY} />
	<line x1="9" x2="9" y1="4.5" y2="9.5" stroke="#ffffff" stroke-opacity="0.8" />
{:else if kind === 'workitem'}
	<rect x="0.5" y="0.5" width="17" height="13" rx="6" fill={color} fill-opacity="0.12" stroke={color} stroke-opacity="0.6" />
	<rect x="3.5" y="4" width="11" height="6" rx="2" fill={GREY} />
{:else if kind === 'step'}
	<circle cx="9" cy="7" r="6.25" fill="#ffffff" stroke="#4b5563" stroke-width="1.5" />
	<text x="9" y="10" text-anchor="middle" font-size="8.5" font-weight="700" fill="#4b5563">2</text>
{:else if kind === 'handoff'}
	<path d="M1 7H13" stroke="#4b5563" stroke-width="1.25" />
	<path d="M12 3.5L18 7L12 10.5Z" fill="#4b5563" />
{:else if kind === 'base'}
	<rect x="0.5" y="1.5" width="17" height="11" rx="3" fill="none" stroke={color} stroke-dasharray="2 2" />
{:else}
	<rect x="0.5" y="1.5" width="17" height="11" rx="3" fill={color} fill-opacity="0.1" stroke={color} stroke-opacity="0.6" />
{/if}
