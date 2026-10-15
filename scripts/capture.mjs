// Dev helper: drives headless Chrome over CDP against the static `build/` output to regenerate
// docs/screenshots/*.png and docs/sample-export.svg. Usage: [SCALE=2] node scripts/capture.mjs [outDir]
// (needs CHROME=/path/to/chrome or google-chrome on PATH; run `pnpm build` first).
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(process.env.BUILD ?? 'build');
const out = resolve(process.argv[2] ?? '.');
const chromeBin = process.env.CHROME ?? 'google-chrome';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = createServer((req, res) => {
	let p = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
	if (!existsSync(p) || p.endsWith('/')) p = join(root, 'index.html');
	res.setHeader('content-type', MIME[extname(p)] ?? 'application/octet-stream');
	res.end(readFileSync(p));
}).listen(0);
const port = server.address().port;
const chrome = spawn(chromeBin, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=9333', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'cap-'))}`, 'about:blank'], { stdio: 'ignore' });

let ws, id = 0;
const pending = new Map();
async function connect() {
	for (let i = 0; i < 50; i++) {
		try {
			const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
			const page = list.find((t) => t.type === 'page');
			if (page) return page.webSocketDebuggerUrl;
		} catch {}
		await sleep(200);
	}
	throw new Error('chrome did not start');
}
const send = (method, params = {}) =>
	new Promise((resolve, reject) => {
		const i = ++id;
		pending.set(i, { resolve, reject });
		ws.send(JSON.stringify({ id: i, method, params }));
	});
const ev = async (expression) => {
	const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
	if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed');
	return r.result.value;
};
const shot = async (file, selector) => {
	const clip = await ev(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height, scale: 1}; })()`);
	const { data } = await send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true });
	writeFileSync(join(out, file), Buffer.from(data, 'base64'));
};

try {
	ws = new WebSocket(await connect());
	await new Promise((r) => (ws.onopen = r));
	ws.onmessage = (m) => {
		const d = JSON.parse(m.data);
		if (d.id && pending.has(d.id)) {
			const p = pending.get(d.id);
			pending.delete(d.id);
			d.error ? p.reject(new Error(d.error.message)) : p.resolve(d.result);
		}
	};
	await send('Page.enable');
	await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: Number(process.env.SCALE ?? 1), mobile: false });
	await send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
	await sleep(1500);
	mkdirSync(join(out, 'docs/screenshots'), { recursive: true });
	const click = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new MouseEvent('click', {bubbles: true}))`);
	const settle = () => sleep(400);
	const page = 'body';

	// capture the export through the demo's own Export SVG button
	await ev(`(() => { const o = URL.createObjectURL; URL.createObjectURL = (b) => { window.__blob = b; return o.call(URL, b); }; })()`);
	const exportNow = async (file) => {
		await ev(`window.__blob = null`);
		await ev(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Export SVG').click()`);
		await sleep(300);
		writeFileSync(join(out, file), await ev(`window.__blob.text()`));
	};

	await shot('docs/screenshots/a-compact-parallel-lanes.png', page);
	await exportNow('docs/sample-export.svg');
	// ONLY_OVERVIEW=1 stops after the overview shot + export (handy for checking other traces via BUILD=...)
	if (!process.env.ONLY_OVERVIEW) {
		await click('[data-span-id="research-a-2"]'); await settle();
		await shot('docs/screenshots/b-resumed-session.png', page);
		await ev(`document.querySelector('[data-event-id="compact-research-a"]')?.dispatchEvent(new MouseEvent('click', {bubbles: true}))`);
		await settle();
		await shot('docs/screenshots/c-compaction-details.png', page);
		// worktree highlight: click the backend region's label chip (same path as hover/click on the region)
		await ev(`document.querySelector('.work-timeline')?.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}))`);
		await click('[data-worktree-chip][data-worktree-id="wt-backend"]'); await settle();
		await shot('docs/screenshots/d-worktrees-highlighted.png', page);
		// narrow layout check
		await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 1000, deviceScaleFactor: Number(process.env.SCALE ?? 1), mobile: false });
		await settle();
		await shot('docs/screenshots/e-narrow-900.png', page);
	}
} finally {
	chrome.kill();
	server.close();
	process.exit(0);
}
