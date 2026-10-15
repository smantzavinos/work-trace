// Cheap text helpers. Pure; no DOM, so layout-ish decisions are deterministic (also in exports).

/** Approximate advance width of `text` in a humanist sans (Inter / system-ui) at `size` px. */
export function measureText(text: string, size: number, weight = 400): number {
	let em = 0;
	for (const ch of text) {
		if ('iljI.,:;\'|!` '.includes(ch)) em += 0.28;
		else if ('ftr()[]/\\-"*'.includes(ch)) em += 0.38;
		else if ('mw'.includes(ch)) em += 0.86;
		else if ('MW@'.includes(ch)) em += 0.92;
		else if (ch >= 'A' && ch <= 'Z') em += 0.66;
		else if (ch >= '0' && ch <= '9') em += 0.6;
		else if (ch === '·' || ch === '›') em += 0.4;
		else if (ch.charCodeAt(0) > 0x2000) em += 0.9;
		else em += 0.57;
	}
	return em * size * (weight >= 600 ? 1.05 : weight >= 500 ? 1.02 : 1);
}

/** Text width function: (text, px size, weight) -> px. */
export type Measure = (text: string, size: number, weight?: number) => number;

/** Must match `.at-root` in svg-style.ts so canvas and SVG resolve the same font. */
export const FONT_STACK =
	"Inter,ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

let ctx: CanvasRenderingContext2D | null | undefined;
const cache = new Map<string, number>();

/**
 * Exact widths from the browser's own font (canvas), so labels use all the room they have.
 * Falls back to the `measureText` estimate outside a browser. Exports keep the estimate: the
 * SVG may be opened where a different font resolves, and the estimate errs on the wide side.
 */
export const domMeasure: Measure = (text, size, weight = 400) => {
	if (ctx === undefined)
		ctx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
	if (!ctx) return measureText(text, size, weight);
	const key = `${weight}|${size}|${text}`;
	let w = cache.get(key);
	if (w === undefined) {
		if (cache.size > 20_000) cache.clear();
		ctx.font = `${weight} ${size}px ${FONT_STACK}`;
		// +2%: SVG text rendering and canvas metrics can differ by a hair.
		w = ctx.measureText(text).width * 1.02;
		cache.set(key, w);
	}
	return w;
};

/** Id-safe, deterministic token for an arbitrary string (sanitized + short hash). */
export function safeId(raw: string): string {
	let h = 5381;
	for (let i = 0; i < raw.length; i++) h = ((h << 5) + h + raw.charCodeAt(i)) >>> 0;
	return `${raw.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40)}-${h.toString(36)}`;
}
