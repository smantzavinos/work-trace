// Precompiled at dev time (scripts/gen-validator.mjs): no runtime schema compilation,
// no `new Function`, works under a strict Content-Security-Policy.
import validateSchema from './schema-validator.generated.js';
import { buildIndex, effectiveEndMs } from './indexes.js';
import type { WorkTrace, ValidationIssue, ValidationResult } from './types.js';

/** Structural (JSON Schema v3) + semantic validation. Never mutates input. */
export function validateTrace(input: unknown): ValidationResult<WorkTrace> {
	const validate = validateSchema;
	if (!validate(input)) {
		const issues = (validate.errors ?? []).map((e) => ({
			path: e.instancePath || '/',
			message: [e.message, e.params && JSON.stringify(e.params)].filter(Boolean).join(' ')
		}));
		return { ok: false, issues };
	}
	const trace = input as WorkTrace;
	const issues = semanticIssues(trace);
	return issues.length ? { ok: false, issues } : { ok: true, value: trace, issues: [] };
}

function semanticIssues(trace: WorkTrace): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const add = (path: string, message: string) => issues.push({ path, message });
	const until = trace.trace.observedUntilMs;

	// 1. unique IDs per collection
	const collections = [
		'repositories',
		'worktrees',
		'worktreeRefs',
		'agentSessions',
		'spans',
		'events'
	] as const;
	for (const c of collections) {
		const seen = new Set<string>();
		trace[c].forEach((item, i) => {
			if (seen.has(item.id)) add(`/${c}/${i}/id`, `duplicate id "${item.id}"`);
			seen.add(item.id);
		});
	}
	if (issues.length) return issues;

	const idx = buildIndex(trace);

	// Git references and ref intervals
	trace.worktrees.forEach((w, i) => {
		if (!idx.repositories.has(w.repositoryId))
			add(`/worktrees/${i}/repositoryId`, `unknown repository "${w.repositoryId}"`);
	});
	trace.worktreeRefs.forEach((r, i) => {
		if (!idx.worktrees.has(r.worktreeId))
			add(`/worktreeRefs/${i}/worktreeId`, `unknown worktree "${r.worktreeId}"`);
		if (!(r.startMs < r.endMs)) add(`/worktreeRefs/${i}`, 'ref interval must have startMs < endMs');
		if (r.endMs > until) add(`/worktreeRefs/${i}/endMs`, 'ref interval ends after observedUntilMs');
	});
	for (const [wt, refs] of idx.worktreeRefs) {
		for (let k = 1; k < refs.length; k++) {
			if (refs[k - 1].endMs > refs[k].startMs)
				add(`/worktreeRefs`, `ref intervals "${refs[k - 1].id}" and "${refs[k].id}" overlap in worktree "${wt}"`);
		}
	}

	// 2. spans: references and time ranges
	trace.spans.forEach((s, i) => {
		const p = `/spans/${i}`;
		if (s.endMs !== undefined && !(s.endMs > s.startMs)) add(`${p}/endMs`, 'endMs must be > startMs');
		if (s.startMs > until || (s.endMs ?? 0) > until)
			add(p, `span "${s.id}" extends beyond observedUntilMs`);
		if (s.worktreeId !== undefined && !idx.worktrees.has(s.worktreeId))
			add(`${p}/worktreeId`, `unknown worktree "${s.worktreeId}"`);
		if (s.kind === 'agent' && !idx.sessions.has(s.sessionId))
			add(`${p}/sessionId`, `unknown session "${s.sessionId}"`);
		if (s.parentId !== undefined) {
			const parent = idx.spans.get(s.parentId);
			if (!parent) add(`${p}/parentId`, `unknown parent span "${s.parentId}"`);
			else if (parent.id === s.id) add(`${p}/parentId`, 'span cannot be its own parent');
			else if (s.startMs < parent.startMs || s.startMs > effectiveEndMs(parent, until))
				add(`${p}/startMs`, `span "${s.id}" starts outside its parent's lifetime`);
		}
	});

	// 3. parent cycles (parentId only)
	const state = new Map<string, 1 | 2>();
	for (const s of trace.spans) {
		const path: string[] = [];
		let cur: string | undefined = s.id;
		while (cur && !state.has(cur)) {
			state.set(cur, 1);
			path.push(cur);
			cur = idx.spans.get(cur)?.parentId;
		}
		if (cur && state.get(cur) === 1) add('/spans', `parent cycle through "${cur}"`);
		for (const id of path) state.set(id, 2);
	}

	// 4. session continuity / exclusivity (independent of parentage)
	for (const [sessionId, runs] of idx.sessionSpans) {
		runs.forEach((run, k) => {
			const prev = runs[k - 1];
			if (!prev) {
				if (run.mode !== 'start')
					add('/spans', `first activation "${run.id}" of session "${sessionId}" must be mode "start"`);
				return;
			}
			if (prev.endMs === undefined)
				add('/spans', `running span "${prev.id}" cannot be followed by "${run.id}" in session "${sessionId}"`);
			else if (prev.endMs > run.startMs)
				add('/spans', `spans "${prev.id}" and "${run.id}" overlap in session "${sessionId}"`);
			if (run.mode !== 'resume')
				add('/spans', `later activation "${run.id}" of session "${sessionId}" must be mode "resume"`);
			else if (run.resumesSpanId !== prev.id)
				add('/spans', `"${run.id}" must resume the immediately prior activation "${prev.id}"`);
		});
	}
	trace.spans.forEach((s, i) => {
		if (s.kind !== 'agent' || s.resumesSpanId === undefined) return;
		const target = idx.spans.get(s.resumesSpanId);
		if (!target) add(`/spans/${i}/resumesSpanId`, `unknown span "${s.resumesSpanId}"`);
		else if (target.kind !== 'agent' || target.sessionId !== s.sessionId)
			add(`/spans/${i}/resumesSpanId`, 'resumesSpanId must reference an agent span of the same session');
	});

	// 6. compaction anchors
	trace.events.forEach((e, i) => {
		const p = `/events/${i}`;
		if (!idx.sessions.has(e.sessionId)) add(`${p}/sessionId`, `unknown session "${e.sessionId}"`);
		if (e.endMs !== undefined && !(e.endMs > e.atMs)) add(`${p}/endMs`, 'endMs must be > atMs');
		if (Math.max(e.atMs, e.endMs ?? 0) > until) add(p, 'event extends beyond observedUntilMs');
		if (e.spanId === undefined) return;
		const span = idx.spans.get(e.spanId);
		if (!span) return add(`${p}/spanId`, `unknown span "${e.spanId}"`);
		if (span.kind !== 'agent' || span.sessionId !== e.sessionId)
			return add(`${p}/spanId`, 'spanId must be an agent span of the same session');
		const end = effectiveEndMs(span, until);
		if (e.atMs < span.startMs || e.atMs > end || (e.endMs ?? e.atMs) > end)
			add(p, `event lies outside anchor span "${span.id}"`);
	});

	return issues;
}
