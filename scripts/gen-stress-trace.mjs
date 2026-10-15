// Dev helper: writes a large, deterministic schema-v3 trace for scale testing.
// Usage: node scripts/gen-stress-trace.mjs [out.json] [agents=120] [worktrees=20] [hours=2]
// Shape: one orchestrator; waves of sub-agents (some nested, some resumed), each with tool and
// model calls; most sub-agents work in their own linked worktree; compactions and branch switches.
import { writeFileSync } from 'node:fs';

const [out = 'stress-trace.json', nAgents = '120', nWt = '20', hours = '2'] = process.argv.slice(2);
const AGENTS = Number(nAgents);
const WTS = Number(nWt);
const UNTIL = Math.round(Number(hours) * 3_600_000);

let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

const TYPES = ['implementer', 'researcher', 'reviewer', 'tester', 'planner', 'debugger'];
const TOOLS = ['Read file', 'Edit file', 'Run tests', 'Grep', 'Build', 'Lint', 'Git diff', 'List directory', 'Web fetch'];
const TOPICS = ['auth', 'billing', 'search', 'notifications', 'uploads', 'reports', 'onboarding', 'settings', 'audit log', 'rate limits', 'cache', 'webhooks'];

const worktrees = [{ id: 'wt-main', repositoryId: 'repo', label: 'Main checkout', kind: 'main' }];
const worktreeRefs = [{ id: 'ref-main', worktreeId: 'wt-main', startMs: 0, endMs: UNTIL, ref: { kind: 'branch', name: 'main' } }];
for (let i = 1; i <= WTS; i++) {
	const topic = TOPICS[(i - 1) % TOPICS.length];
	worktrees.push({ id: `wt-${i}`, repositoryId: 'repo', label: `${topic} worktree ${i}`, kind: 'linked', path: `../wt-${i}` });
	const switchAt = int(UNTIL * 0.3, UNTIL * 0.8);
	worktreeRefs.push(
		{ id: `ref-${i}a`, worktreeId: `wt-${i}`, startMs: 0, endMs: switchAt, ref: { kind: 'branch', name: `feat/${topic.replace(' ', '-')}-${i}` } },
		{ id: `ref-${i}b`, worktreeId: `wt-${i}`, startMs: switchAt, endMs: UNTIL, ref: { kind: 'branch', name: `fix/${topic.replace(' ', '-')}-${i}` } }
	);
}

const sessions = [{ id: 's-main', agentType: 'orchestrator', label: 'Orchestrator' }];
const spans = [{ id: 'main', kind: 'agent', sessionId: 's-main', mode: 'start', label: 'Orchestrate release', startMs: 0, endMs: UNTIL, status: 'ok', worktreeId: 'wt-main' }];
const events = [];
let nSpan = 0;

/** Tool/model calls inside [s, e) of agent `parent`, sequential with small gaps. */
function calls(parent, s, e, wt) {
	let t = s + int(500, 4000);
	while (t < e - 2000) {
		const isModel = rnd() < 0.35;
		const d = isModel ? int(1500, 20_000) : int(200, 45_000);
		const end = Math.min(e - 500, t + d);
		spans.push({
			id: `c${++nSpan}`,
			kind: isModel ? 'model' : 'tool',
			parentId: parent,
			label: isModel ? 'Model call' : pick(TOOLS),
			startMs: t,
			endMs: end,
			status: rnd() < 0.04 ? 'error' : 'ok',
			worktreeId: wt
		});
		t = end + int(200, 6000);
	}
}

function agent(i, parentId, s, e, wt, depth) {
	const type = pick(TYPES);
	const topic = pick(TOPICS);
	const sid = `s-${i}`;
	sessions.push({ id: sid, agentType: type, label: `${type} · ${topic}` });
	const resumed = depth === 0 && rnd() < 0.25 && e - s > 600_000;
	const runs = resumed ? [[s, s + (e - s) * 0.45], [s + (e - s) * 0.6, e]] : [[s, e]];
	let prev;
	runs.forEach(([rs, re], k) => {
		const id = `a${i}${k ? `-r${k}` : ''}`;
		rs = Math.round(rs);
		re = Math.round(re);
		spans.push({
			id,
			kind: 'agent',
			parentId,
			sessionId: sid,
			mode: k ? 'resume' : 'start',
			...(prev ? { resumesSpanId: prev } : {}),
			label: `${k ? 'Continue' : pick(['Implement', 'Investigate', 'Review', 'Test', 'Plan', 'Fix'])} ${topic}`,
			startMs: rs,
			endMs: re,
			status: rnd() < 0.05 ? 'error' : 'ok',
			worktreeId: wt
		});
		if (re - rs > 900_000 && rnd() < 0.5)
			events.push({ id: `cmp-${id}`, kind: 'compaction', sessionId: sid, spanId: id, atMs: Math.round(rs + (re - rs) * 0.5), trigger: 'automatic', outcome: 'ok' });
		calls(id, rs, re, wt);
		if (depth === 0 && rnd() < 0.3) {
			const hs = rs + int(1000, (re - rs) / 3);
			const he = Math.min(re - 1000, hs + int(60_000, (re - rs) / 2));
			if (he > hs + 10_000) agent(`${i}h${k}`, id, hs, he, wt, depth + 1);
		}
		prev = id;
	});
}

// Waves: the orchestrator fans out ~AGENTS sub-agents over the run, a few at a time.
let t = 30_000;
for (let i = 0; i < AGENTS; i++) {
	const dur = int(120_000, Math.min(2_400_000, UNTIL / 3));
	const s = Math.min(UNTIL - 150_000, t);
	const e = Math.min(UNTIL - 10_000, s + dur);
	const wt = rnd() < 0.8 ? `wt-${int(1, WTS)}` : 'wt-main';
	agent(i, 'main', s, e, wt, 0);
	t += int(10_000, Math.round((UNTIL / AGENTS) * 1.6));
	if (t > UNTIL - 200_000) t = int(30_000, UNTIL / 2);
}

const trace = {
	schemaVersion: 3,
	trace: { id: 'stress', title: `Stress: ${AGENTS} agents, ${WTS} worktrees, ${hours}h`, startedAt: '2026-10-15T09:00:00Z', observedUntilMs: UNTIL },
	repositories: [{ id: 'repo', label: 'Monorepo' }],
	worktrees,
	worktreeRefs,
	agentSessions: sessions,
	spans,
	events
};
writeFileSync(out, JSON.stringify(trace));
console.log(`${out}: ${spans.length} spans, ${sessions.length} sessions, ${events.length} events, ${worktrees.length} worktrees`);
