// Schema v3 TypeScript contract. Mirrors work-trace.schema.json.

export type Attributes = Record<string, string | number | boolean | null>;

export interface Repository {
	id: string;
	label?: string;
	remoteUrl?: string;
	attributes?: Attributes;
}

export interface Worktree {
	id: string;
	repositoryId: string;
	label?: string;
	path?: string;
	kind?: 'main' | 'linked' | 'unknown';
	attributes?: Attributes;
}

export type GitRef = { kind: 'branch'; name: string } | { kind: 'detached'; commitSha: string };

export interface WorktreeRefInterval {
	id: string;
	worktreeId: string;
	/** inclusive */
	startMs: number;
	/** exclusive */
	endMs: number;
	ref: GitRef;
}

export interface AgentSession {
	id: string;
	agentType: string;
	label?: string;
	attributes?: Attributes;
}

export type SpanStatus = 'running' | 'ok' | 'error' | 'cancelled';
export type SpanKind = 'agent' | 'tool' | 'model';

interface SpanBase {
	id: string;
	parentId?: string;
	worktreeId?: string;
	label?: string;
	startMs: number;
	/** absent iff status === 'running' */
	endMs?: number;
	status: SpanStatus;
	attributes?: Attributes;
}

export interface AgentSpan extends SpanBase {
	kind: 'agent';
	sessionId: string;
	mode: 'start' | 'resume';
	/** required iff mode === 'resume' */
	resumesSpanId?: string;
}

export interface CallSpan extends SpanBase {
	kind: 'tool' | 'model';
	parentId: string;
	label: string;
}

export type WorkSpan = AgentSpan | CallSpan;

export interface CompactionEvent {
	id: string;
	kind: 'compaction';
	sessionId: string;
	spanId?: string;
	atMs: number;
	endMs?: number;
	trigger?: 'automatic' | 'manual' | 'unknown';
	outcome?: 'ok' | 'error' | 'unknown';
	tokensBefore?: number;
	tokensAfter?: number;
	label?: string;
	attributes?: Attributes;
}

export type WorkEvent = CompactionEvent;

export interface WorkTrace {
	schemaVersion: 3;
	trace: {
		id: string;
		title?: string;
		startedAt?: string;
		observedUntilMs: number;
	};
	repositories: Repository[];
	worktrees: Worktree[];
	worktreeRefs: WorktreeRefInterval[];
	agentSessions: AgentSession[];
	spans: WorkSpan[];
	events: WorkEvent[];
}

export interface ValidationIssue {
	/** JSON-pointer-ish location, e.g. /spans/3/endMs */
	path: string;
	message: string;
}

export type ValidationResult<T> =
	| { ok: true; value: T; issues: [] }
	| { ok: false; value?: undefined; issues: ValidationIssue[] };
