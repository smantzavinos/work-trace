// Axis and duration helpers. Pure.
const NICE_MS = [
	1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000,
	600000, 900000, 1800000, 3600000, 7200000, 14400000, 21600000, 43200000, 86400000
];

/** Smallest "nice" tick interval (ms) that is >= minMs. */
function niceTickInterval(minMs: number): number {
	for (const v of NICE_MS) if (v >= minMs) return v;
	const last = NICE_MS[NICE_MS.length - 1];
	return last * Math.ceil(minMs / last);
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Elapsed-time axis label: "0", "45s", "1:30", "1:05:00", "1.5s". */
export function formatElapsed(ms: number, intervalMs: number): string {
	if (ms === 0) return '0';
	const decimals = intervalMs >= 1000 ? 0 : intervalMs < 10 ? 3 : intervalMs < 100 ? 2 : 1;
	const totalS = ms / 1000;
	if (totalS < 60) return `${totalS.toFixed(decimals)}s`;
	const h = Math.floor(totalS / 3600);
	const m = Math.floor((totalS % 3600) / 60);
	const s = totalS % 60;
	const secStr = decimals ? s.toFixed(decimals).padStart(decimals + 3, '0') : pad2(Math.round(s));
	return h > 0 ? `${h}:${pad2(m)}:${secStr}` : `${m}:${secStr}`;
}

/** Ticks (ms) within [fromMs, toMs], multiples of the interval, at least minPx apart. */
export function axisTicks(
	fromMs: number,
	toMs: number,
	pxPerMs: number,
	minPx = 90
): { ticks: number[]; interval: number } {
	const interval = niceTickInterval(minPx / pxPerMs);
	const ticks: number[] = [];
	const k0 = Math.max(0, Math.ceil(fromMs / interval));
	for (let k = k0; k * interval <= toMs && ticks.length < 400; k++) ticks.push(k * interval);
	return { ticks, interval };
}

/** Milliseconds as seconds with one decimal ("12.3s"). */
export const formatSeconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;
