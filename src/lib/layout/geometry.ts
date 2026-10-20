// Pixel geometry helpers. Pure; the renderer maps scene (ms, row) units to pixels with these.
// Nothing here depends on zoom/pan except the explicit Viewport mapping, and nothing re-runs layout.
import type { TimelineScene, WorktreeRegion } from './compute-layout.js';

export const GEOM = {
	left: 14,
	right: 18,
	rulerH: 28,
	stripH: 22,
	lanePad: 10,
	rowPitch: 28,
	barH: 20,
	radius: 4,
	minBarW: 3,
	minHitW: 8,
	padBottom: 14
} as const;

/** Worktree region box metrics. Chips sit on the top border like a fieldset legend. */
export const REGION = {
	pad: 4,
	/** extra inset per nesting level below, so nested boxes sit inside their parent */
	padStep: 3,
	/** extra top padding (header band for the chip) */
	padTopExtra: 8,
	chipH: 16,
	radius: 6
} as const;

/** Work item band metrics: a tinted pill around the band's row, its title just above the bars. */
export const BAND = {
	pad: 3,
	/** title line above a band row (only while labels are shown) */
	titleH: 15
} as const;

/**
 * Row metrics at a vertical density (1 = normal). Zooming out past "fit" lowers the density:
 * rows get shorter so large traces fit on screen, and detail drops out in steps: labels first
 * (bars too thin to carry text), then worktree chips. Pure; never affects layout (rows).
 */
export interface RowGeom {
	density: number;
	barH: number;
	rowPitch: number;
	radius: number;
	/** span labels, pause pills */
	labels: boolean;
	/** worktree chips (and the header band above region boxes that holds them) */
	chips: boolean;
	regionPad: number;
	regionPadStep: number;
	regionPadTopExtra: number;
	chipH: number;
	/** work item band title line above band rows (0 = titles hidden) */
	bandTitleH: number;
}

export const MIN_DENSITY = 0.15;
/** Below this density, bars are too thin for text. */
export const LABEL_DENSITY = 0.7;
/** Below this density, worktree chips are dropped (boxes stay). */
export const CHIP_DENSITY = 0.85;

export function rowGeom(density = 1): RowGeom {
	const d = Math.min(1, Math.max(MIN_DENSITY, density));
	const barH = Math.max(3, Math.round(GEOM.barH * d));
	const chips = d >= CHIP_DENSITY;
	return {
		density: d,
		barH,
		rowPitch: barH + Math.max(2, Math.round((GEOM.rowPitch - GEOM.barH) * d)),
		radius: Math.min(GEOM.radius, barH / 4),
		labels: d >= LABEL_DENSITY,
		chips,
		regionPad: Math.max(1.5, REGION.pad * d),
		regionPadStep: REGION.padStep * d,
		regionPadTopExtra: chips ? REGION.padTopExtra : 0,
		chipH: chips ? REGION.chipH : 0,
		bandTitleH: d >= LABEL_DENSITY ? BAND.titleH : 0
	};
}

export interface Viewport {
	left: number;
	viewStartMs: number;
	pxPerMs: number;
}

export const timeToX = (vp: Viewport, ms: number): number => vp.left + (ms - vp.viewStartMs) * vp.pxPerMs;

export const barWidth = (vp: Viewport, startMs: number, endMs: number): number =>
	Math.max(GEOM.minBarW, (endMs - startMs) * vp.pxPerMs);

/** Pixels per ms so that [0, untilMs] fits the width. */
export function fitPxPerMs(width: number, untilMs: number): number {
	const room = Math.max(width - GEOM.left - GEOM.right, 20);
	return room / Math.max(untilMs, 1);
}

export const hasEventStrip = (scene: TimelineScene): boolean =>
	scene.positionedEvents.some((e) => e.position === 'event-strip');

/** Y of the first lane row before any region spacing. */
const lanesTop = (strip: boolean): number =>
	GEOM.rulerH + (strip ? GEOM.stripH : 0) + GEOM.lanePad;

// ---- worktree regions ----

/** Number of region nesting levels below each region (0 = leaf); index-aligned with scene.worktreeRegions. */
function regionNesting(regions: readonly WorktreeRegion[]): number[] {
	const sub = new Array<number>(regions.length).fill(0);
	for (let i = regions.length - 1; i >= 0; i--) {
		const a = regions[i];
		for (let j = i + 1; j < regions.length; j++) {
			const b = regions[j];
			if (
				b.depth > a.depth &&
				a.rowStart <= b.rowStart &&
				b.rowEnd <= a.rowEnd &&
				a.startMs <= b.startMs &&
				b.endMs <= a.endMs
			)
				sub[i] = Math.max(sub[i], sub[j] + 1);
		}
	}
	return sub;
}

const regionPad = (g: RowGeom, sub: number): number => g.regionPad + g.regionPadStep * Math.min(sub, 3);
const regionPadTop = (g: RowGeom, sub: number): number => regionPad(g, sub) + g.regionPadTopExtra;

export interface RowMap {
	/** top y of the bar in each lane row */
	y: number[];
	/** chart height up to and including the bottom padding */
	height: number;
	/** per-region nesting (see regionNesting) */
	nesting: number[];
	/** per region: the nearest region before / after it in time that shares rows (or -1) */
	prev: number[];
	next: number[];
	/** space reserved above each row for work item band titles (inside any region box) */
	bandTop: number[];
	/** row metrics this map was built with */
	g: RowGeom;
}

/**
 * Row -> y mapping. Rows are evenly pitched, except that the gap between two rows widens when
 * a worktree region ends above it (its bottom padding) and/or one starts below it (its top
 * padding plus the label chip hanging above the border), so region borders and chips never
 * touch neighbouring bars or each other. Rows carrying a work item band also get its title line.
 * Depends only on the scene.
 */
export function rowMap(scene: TimelineScene, showWorktrees: boolean, g: RowGeom = rowGeom(1)): RowMap {
	const n = scene.totalRows;
	const bandTop = new Array<number>(n + 1).fill(0);
	for (const b of scene.workItemBands) bandTop[b.row] = g.bandTitleH;
	const regions = showWorktrees ? scene.worktreeRegions : [];
	const nesting = regionNesting(regions);
	/** space needed above each row for the chips of regions starting there */
	const startNeed = new Array<number>(n + 1).fill(0);
	/** space needed below each row for the padding of regions ending there */
	const endNeed = new Array<number>(n + 1).fill(0);
	regions.forEach((r, i) => {
		const sub = nesting[i];
		startNeed[r.rowStart] = Math.max(startNeed[r.rowStart], regionPadTop(g, sub) + g.chipH / 2);
		endNeed[r.rowEnd] = Math.max(endNeed[r.rowEnd], regionPad(g, sub));
	});
	const prev = new Array<number>(regions.length).fill(-1);
	const next = new Array<number>(regions.length).fill(-1);
	regions.forEach((r, i) => {
		regions.forEach((o, j) => {
			if (i === j || o.rowEnd < r.rowStart || o.rowStart > r.rowEnd) return;
			if (o.endMs <= r.startMs && (prev[i] < 0 || o.endMs > regions[prev[i]].endMs)) prev[i] = j;
			else if (o.startMs >= r.endMs && (next[i] < 0 || o.startMs < regions[next[i]].startMs)) next[i] = j;
		});
	});
	const gapBelow = g.rowPitch - g.barH;
	let y = lanesTop(hasEventStrip(scene));
	const ys: number[] = [];
	for (let r = 0; r < n; r++) {
		if (r === 0) y += Math.max(0, startNeed[0] + bandTop[0] + 4 * g.density - GEOM.lanePad);
		else {
			const sum = startNeed[r] + endNeed[r - 1] + bandTop[r];
			const need = sum > 0 ? sum + 2 * g.density : 0;
			y += Math.max(gapBelow, need) - gapBelow;
		}
		ys.push(y);
		y += g.rowPitch;
	}
	// y is now one pitch past the last row's top
	const height = y - gapBelow + Math.max(GEOM.padBottom, (endNeed[n - 1] ?? 0) + 8);
	return { y: ys, height, nesting, prev, next, bandTop, g };
}

export interface RegionRect {
	region: WorktreeRegion;
	index: number;
	x1: number;
	x2: number;
	y1: number;
	y2: number;
}

export function regionRects(scene: TimelineScene, rm: RowMap, vp: Viewport): RegionRect[] {
	const regions = scene.worktreeRegions;
	return regions.map((region, index) => {
		const sub = rm.nesting[index] ?? 0;
		const pad = regionPad(rm.g, sub);
		const x1 = timeToX(vp, region.startMs);
		const x2 = timeToX(vp, region.endMs);
		// Back-to-back regions in shared rows would overlap by their paddings: split the gap.
		let padL = pad;
		let padR = pad;
		const before = regions[rm.prev[index]];
		const after = regions[rm.next[index]];
		if (before) padL = Math.min(padL, Math.max(0, (x1 - timeToX(vp, before.endMs)) / 2));
		if (after) padR = Math.min(padR, Math.max(0, (timeToX(vp, after.startMs) - x2) / 2));
		return {
			region,
			index,
			x1: x1 - padL,
			x2: x2 + padR,
			y1: rm.y[region.rowStart] - rm.bandTop[region.rowStart] - regionPadTop(rm.g, sub),
			y2: rm.y[region.rowEnd] + rm.g.barH + pad
		};
	});
}
