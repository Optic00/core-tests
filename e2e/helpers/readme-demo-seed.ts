import fs from "node:fs";
import path from "node:path";
import type { APIRequestContext } from "@playwright/test";

/**
 * Seeds a rich, realistic demo dataset through the production HTTP API for
 * documentation screenshots (README and marketing captures). Unlike the
 * shared test fixtures, this favors visual density — deep hierarchies,
 * realistic titles, planning objects, knowledge pages, and test management —
 * over the minimal state most specs need.
 *
 * Deterministic via a fixed PRNG seed so re-runs produce comparable data.
 */

interface Req {
	get(url: string): Promise<unknown>;
	post(url: string, data?: unknown): Promise<unknown>;
	patch(url: string, data: unknown): Promise<unknown>;
	put(url: string, data: unknown): Promise<unknown>;
}

/** Wrap Playwright's APIRequestContext with unwrapped `{data}` bodies. */
function api(request: APIRequestContext): Req {
	const headers = { "Sec-Fetch-Site": "same-origin" };
	const mergeHeaders = { ...headers, "Content-Type": "application/merge-patch+json" };
	async function unwrap(promise: Promise<any>): Promise<any> {
		const res = await promise;
		const body = await res.json().catch(() => undefined);
		if (res.ok() === false) {
			throw new Error(`${res.status()} ${res.url()}: ${JSON.stringify(body).slice(0, 300)}`);
		}
		return body && typeof body === "object" && "data" in body ? body.data : body;
	}
	return {
		get: (url) => unwrap(request.get(url, { headers })),
		post: (url, data) => unwrap(request.post(url, { headers, data })),
		patch: (url, data) => unwrap(request.patch(url, { headers: mergeHeaders, data })),
		put: (url, data) => unwrap(request.put(url, { headers, data })),
	};
}

// ─── deterministic PRNG ──────────────────────────────────────────────────────

function mulberry32(seed: number) {
	let s = seed | 0;
	return () => {
		s = (s + 0x6d2b79d5) | 0;
		let t = Math.imul(s ^ (s >>> 15), 1 | s);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const rng = mulberry32(20260921);
const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
const int = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));

function isoDaysFromNow(days: number): string {
	const d = new Date();
	d.setDate(d.getDate() + days);
	return d.toISOString();
}

function dateOnly(days: number): string {
	return isoDaysFromNow(days).slice(0, 10);
}

// ─── content pools ───────────────────────────────────────────────────────────

const CLOUD = {
	domain: ["Kubernetes", "Terraform", "AWS", "GCP", "Azure", "Docker", "Helm", "Istio", "Prometheus", "Grafana"],
	nouns: ["cluster", "node pool", "pod", "service mesh", "load balancer", "VPC", "subnet", "firewall rule", "IAM policy", "certificate", "autoscaler", "object store"],
	prefixes: ["Infrastructure", "Platform", "Networking", "Observability", "Security", "Cost Optimization", "Disaster Recovery"],
};

const ECOM = {
	domain: ["Stripe", "Elasticsearch", "Redis", "CDN", "recommendation engine", "inventory API"],
	nouns: ["checkout flow", "product catalog", "shopping cart", "payment gateway", "order pipeline", "shipping integration", "coupon engine", "storefront"],
	prefixes: ["Checkout", "Catalog", "Payments", "Orders", "Search", "Fulfillment"],
};

const VERBS = ["Implement", "Design", "Build", "Migrate", "Automate", "Harden", "Scale", "Refactor", "Standardize", "Provision"];
const ADJ = ["scalable", "fault-tolerant", "multi-region", "zero-downtime", "cost-efficient", "observable"];

function epicTitle(ws: typeof CLOUD): string {
	return `${pick(ws.prefixes)}: ${pick(VERBS)} ${pick(ws.nouns)}s`;
}
function storyTitle(ws: typeof CLOUD): string {
	if (rng() < 0.35) return `${pick(VERBS)} ${pick(ws.domain)} ${pick(ws.nouns)}`;
	return `${pick(VERBS)} ${pick(ADJ)} ${pick(ws.nouns)}`;
}
function subtaskTitle(ws: typeof CLOUD): string {
	return `${pick(["Write tests for", "Document", "Review", "Deploy", "Benchmark", "Configure"])} ${pick(ws.nouns)}`;
}

function description(ws: typeof CLOUD): string {
	const noun = pick(ws.nouns);
	const domain = pick(ws.domain);
	return [
		"## Context",
		`The current ${noun} setup limits how quickly the platform team can ship ${domain} changes. `,
		pick([
			"Production metrics over the last quarter show degraded p99 latency during peak traffic.",
			"Two recent incidents traced back to the same missing failover path.",
			"The quarterly architecture review flagged this area for modernization.",
		]),
		"\n## Approach",
		`- Introduce a staged rollout with automated rollback for ${noun} changes\n- Wire ${domain} telemetry into the shared observability stack\n- Codify the configuration in reviewable infrastructure-as-code`,
		"\n## Acceptance criteria",
		"- No sustained error-rate increase during rollout windows\n- Runbook updated and exercised in a game day",
	].join("\n");
}

const USERS = [
	{ email: "oliver.chen@demo.com", username: "oliverch", password: "oliverch", first_name: "Oliver", last_name: "Chen" },
	{ email: "maya.patel@demo.com", username: "mayap", password: "mayap", first_name: "Maya", last_name: "Patel" },
	{ email: "lucas.silva@demo.com", username: "lucass", password: "lucass", first_name: "Lucas", last_name: "Silva" },
	{ email: "emma.mueller@demo.com", username: "emmam", password: "emmam", first_name: "Emma", last_name: "Müller" },
	{ email: "yuki.tanaka@demo.com", username: "yukit", password: "yukit", first_name: "Yuki", last_name: "Tanaka" },
	{ email: "sofia.rossi@demo.com", username: "sofiar", password: "sofiar", first_name: "Sofia", last_name: "Russo" },
];

const TYPE = { epic: 2, story: 3, task: 4, bug: 5, subtask: 6 };
const STATUS = { open: 1, progress: 2, done: 3 };
const PRIORITY = { critical: 1, high: 2, medium: 3, low: 4 };

function rollStatus(): number {
	const r = rng();
	if (r < 0.3) return STATUS.open;
	if (r < 0.58) return STATUS.progress;
	return STATUS.done;
}
function rollPriority(): number {
	const r = rng();
	if (r < 0.05) return PRIORITY.critical;
	if (r < 0.35) return PRIORITY.high;
	if (r < 0.85) return PRIORITY.medium;
	return PRIORITY.low;
}

export interface ReadmeDemoState {
	cloudWorkspaceId: number;
	milestoneId: number;
	pageId: number;
	testRunId: number;
	featuredItemId: number;
}

/**
 * Seed exactly once per Playwright run and share the resulting state across
 * parallel workers: the first worker to claim the lock file performs the
 * seeding and writes a marker JSON; the rest poll for the marker and reuse
 * the recorded ids.
 */
export async function seedReadmeDemoOnce(request: APIRequestContext): Promise<ReadmeDemoState> {
	const dir = path.join(
		process.env.E2E_OUTPUT_DIR ?? "test-results",
		"readme-seed-shared",
	);
	fs.mkdirSync(dir, { recursive: true });
	const lockPath = path.join(dir, "lock");
	const markerPath = path.join(dir, "state.json");

	let lockHandle: number;
	try {
		lockHandle = fs.openSync(lockPath, "wx");
	} catch {
		// Another worker is seeding — wait for the marker.
		const deadline = Date.now() + 5 * 60 * 1000;
		while (Date.now() < deadline) {
			if (fs.existsSync(markerPath)) {
				return JSON.parse(fs.readFileSync(markerPath, "utf8")) as ReadmeDemoState;
			}
			await new Promise((r) => setTimeout(r, 1000));
		}
		throw new Error("readme-demo-seed: timed out waiting for the seeding worker");
	}
	try {
		const state = await seedReadmeDemo(request);
		fs.writeFileSync(markerPath, JSON.stringify(state));
		return state;
	} catch (err) {
		// Release the lock so a retry could run; surface the failure.
		fs.closeSync(lockHandle);
		fs.rmSync(lockPath, { force: true });
		throw err;
	} finally {
		try {
			fs.closeSync(lockHandle);
		} catch {
			/* already closed on the error path */
		}
	}
}

export async function seedReadmeDemo(request: APIRequestContext): Promise<ReadmeDemoState> {
	const apir = api(request);

	// ─── users ─────────────────────────────────────────────────────────
	// Accounts created through this endpoint land inactive; activate them so
	// they appear as assignable users in the UI.
	const userIds: number[] = [];
	for (const u of USERS) {
		try {
			const created = (await apir.post("/api/users", u)) as { id: number };
			userIds.push(created.id);
		} catch {
			// already exists (re-run against a persistent instance)
		}
	}
	for (const id of userIds) {
		await apir.post(`/api/users/${id}/activate`).catch(() => {});
	}
	const users = (await apir.get("/api/v2/users?page_size=100")) as Array<{ id: number; username: string }>;
	for (const u of users) {
		if (u.username !== "admin") userIds.push(u.id);
	}
	const uniqueUserIds = [...new Set(userIds)].filter((id) => id > 1);
	if (uniqueUserIds.length === 0) throw new Error("readme-demo-seed: no assignable users");
	const assignee = () => (rng() < 0.85 ? pick(uniqueUserIds) : undefined);

	// ─── workspaces ────────────────────────────────────────────────────
	const cloud = (await apir.post("/api/v2/workspaces", {
		name: "Cloud Infrastructure",
		key: "CLOUD",
		description: "Cloud platform engineering, infrastructure automation, and reliability",
	})) as { id: number };
	const ecom = (await apir.post("/api/v2/workspaces", {
		name: "E-Commerce Platform",
		key: "ECOM",
		description: "Online marketplace, shopping cart, payments, and order management",
	})) as { id: number };

	// ─── planning objects (CLOUD) ──────────────────────────────────────
	const alpha = (await apir.post(`/api/v2/workspaces/${cloud.id}/milestones`, {
		name: "CLOUD Alpha Release",
		description: "Alpha release milestone for Cloud Infrastructure",
		target_date: dateOnly(21),
		status: "in-progress",
	})) as { id: number };
	await apir.post(`/api/v2/workspaces/${cloud.id}/milestones`, {
		name: "CLOUD Beta Release",
		description: "Beta release milestone for Cloud Infrastructure",
		target_date: dateOnly(63),
		status: "planning",
	});
	const sprint14 = (await apir.post(`/api/v2/workspaces/${cloud.id}/iterations`, {
		name: "CLOUD Sprint 14",
		description: "Current sprint",
		start_date: dateOnly(-3),
		end_date: dateOnly(11),
		status: "active",
	})) as { id: number };
	await apir.post(`/api/v2/workspaces/${cloud.id}/iterations`, {
		name: "CLOUD Sprint 15",
		description: "Next sprint",
		start_date: dateOnly(11),
		end_date: dateOnly(25),
		status: "planned",
	});

	// ─── work items ────────────────────────────────────────────────────
	async function createItem(workspaceId: number, ws: typeof CLOUD, payload: Record<string, unknown>): Promise<number> {
		const item = (await apir.post("/api/v2/items", {
			workspace_id: workspaceId,
			description: description(ws),
			priority_id: rollPriority(),
			assignee_id: assignee(),
			...payload,
		})) as { id: number };
		return item.id;
	}

	async function createHierarchy(workspaceId: number, ws: typeof CLOUD, epicCount: number, planning: boolean): Promise<void> {
		for (let e = 0; e < epicCount; e++) {
			const inMilestone = planning && rng() < 0.45;
			const epicStart = int(-16, -2);
			const epicEnd = epicStart + int(28, 55);
			const epicId = await createItem(workspaceId, ws, {
				title: epicTitle(ws),
				item_type_id: TYPE.epic,
				status_id: rollStatus(),
				milestone_ids: inMilestone ? [alpha.id] : undefined,
				start_date: isoDaysFromNow(epicStart),
				due_date: isoDaysFromNow(epicEnd),
			});
			const storyCount = int(4, 6);
			for (let s = 0; s < storyCount; s++) {
				const storyInMilestone = inMilestone && rng() < 0.5;
				let status = rollStatus();
				if (storyInMilestone) status = rng() < 0.5 ? STATUS.done : STATUS.progress;
				const start = int(epicStart, Math.max(epicStart, epicEnd - 10));
				const end = Math.min(start + int(8, 25), epicEnd);
				const storyId = await createItem(workspaceId, ws, {
					title: storyTitle(ws),
					parent_id: epicId,
					item_type_id: TYPE.story,
					status_id: status,
					iteration_id: planning && rng() < 0.5 ? sprint14.id : undefined,
					milestone_ids: storyInMilestone ? [alpha.id] : undefined,
					start_date: isoDaysFromNow(start),
					due_date: isoDaysFromNow(end),
				});
				if (rng() < 0.45) {
					const subtasks = int(2, 3);
					for (let t = 0; t < subtasks; t++) {
						await createItem(workspaceId, ws, {
							title: subtaskTitle(ws),
							parent_id: storyId,
							item_type_id: TYPE.subtask,
							status_id: rollStatus(),
							start_date: isoDaysFromNow(start),
							due_date: isoDaysFromNow(Math.min(end, start + int(3, 12))),
						});
					}
				}
			}
		}
		for (let b = 0; b < 6; b++) {
			await createItem(workspaceId, ws, {
				title: rng() < 0.5 ? `${pick(["Fix", "Resolve", "Patch"])} ${pick(ws.nouns)} ${pick(["regression", "flap", "leak", "timeout", "drift"])}` : `${pick(VERBS)} ${pick(ws.nouns)}`,
				item_type_id: rng() < 0.6 ? TYPE.bug : TYPE.task,
				status_id: rollStatus(),
			});
		}
	}

	await createHierarchy(cloud.id, CLOUD, 14, true);
	await createHierarchy(ecom.id, ECOM, 6, false);

	// ─── featured item with discussion ─────────────────────────────────
	const featured = (await apir.post("/api/v2/items", {
		workspace_id: cloud.id,
		title: "Design regional failover for the edge load balancers",
		description: [
			"## Problem",
			"The edge load balancers currently fail over within a region only. A regional outage in `us-east-1` last quarter took the public API down for 23 minutes because health checks never promoted the `eu-west-1` pool.",
			"## Proposal",
			"- Promote two anycast frontends with shared state via GSLB\n- Drain connections on promotion with a 30s grace period\n- Add synthetic canaries in three regions that exercise promotion weekly",
			"## Risks",
			"Session stickiness depends on the shared state store; if replication lag exceeds 2s we will surface stale sessions rather than drop them. We prefer stale-but-alive over downtime.",
		].join("\n"),
		item_type_id: TYPE.story,
		status_id: STATUS.progress,
		priority_id: PRIORITY.high,
		assignee_id: uniqueUserIds[0],
		milestone_ids: [alpha.id],
		iteration_id: sprint14.id,
		due_date: isoDaysFromNow(9),
	})) as { id: number };
	const comments = [
		"Drafted the GSLB config — the promotion path is deterministic now, but the drain grace period needs a knob per frontend.",
		"Can we reuse the synthetic canaries from the storage team? They already run in three regions and publish to the same alerting topic.",
		"Good call. Let's fold their canary bundle in and keep the game day on the calendar for the Thursday after next.",
];
	for (const content of comments) {
		await apir.post(`/api/v2/items/${featured.id}/comments`, {
			content,
		});
	}

	// ─── knowledge pages ───────────────────────────────────────────────
	const home = (await apir.post(`/api/v2/workspaces/${cloud.id}/pages`, {
		title: "Platform Engineering Handbook",
		is_home: true,
		content: [
			"# Platform Engineering Handbook",
			"",
			"Everything the platform team needs to design, ship, and operate cloud infrastructure safely.",
			"",
			"## On-call",
			"",
			"Follow the incident response checklist in **Runbooks → Incident Response** before paging anyone.",
			"",
			"## Change management",
			"",
			"All production changes require a reviewed pull request and a staged rollout.",
		].join("\n"),
	})) as { id: number };
	await apir.post(`/api/v2/workspaces/${cloud.id}/pages`, {
		title: "Incident Response",
		parent_id: home.id,
		content: [
			"# Incident Response",
			"",
			"1. Acknowledge the page in under 5 minutes.",
			"2. Open a channel and assign an incident commander.",
			"3. Post status updates every 30 minutes.",
			"",
			"| Severity | Definition | Response |",
			"| --- | --- | --- |",
			"| SEV1 | Customer-impacting outage | Page on-call + IC immediately |",
			"| SEV2 | Degraded service | Respond within 1 hour |",
			"| SEV3 | Minor issue | Next business day |",
		].join("\n"),
	});
	await apir.post(`/api/v2/workspaces/${cloud.id}/pages`, {
		title: "Terraform Style Guide",
		parent_id: home.id,
		content: [
			"# Terraform Style Guide",
			"",
			"- One resource per logical service; modules for anything reused twice.",
			"- Pin provider versions; never use `latest`.",
			"- Every module ships with examples and a README.",
		].join("\n"),
	});

	// ─── test management ───────────────────────────────────────────────
	const folder = (await apir.post(`/api/v2/workspaces/${cloud.id}/test-folders`, {
		name: "Load Balancer Release",
		description: "Regression coverage for the Q3 load balancer rollout",
	})) as { id: number };
	const caseDefs = [
		{
			title: "Verify TLS termination under sustained load",
			preconditions: "Staging cluster with canary weight 100%",
			steps: [
				{ action: "Route 5k rps through the load balancer for 30 minutes", data: "k6 scenario: sustained-tls", expected: "p99 latency stays under 180ms" },
				{ action: "Rotate the leaf certificate mid-run", data: "cert-rotator --now", expected: "Zero connection errors during rotation" },
			],
		},
		{
			title: "Failover to secondary region drains connections gracefully",
			preconditions: "Both regions healthy, replication lag under 2s",
			steps: [
				{ action: "Trigger regional failover", data: "--failover secondary", expected: "Active connections drained within 30s" },
				{ action: "Verify session stickiness after failover", data: "", expected: "No more than 0.1% of sessions lost" },
			],
		},
		{
			title: "Health checks remove unhealthy backends within threshold",
			preconditions: "Three healthy backends registered",
			steps: [
				{ action: "Kill one backend process", data: "pkill -f backend-node", expected: "Health check flips to unhealthy within 10s" },
				{ action: "Observe traffic shift", data: "", expected: "Traffic redistributed with no 5xx spike" },
			],
		},
		{
			title: "IAM policy changes apply without restart",
			preconditions: "Admin credentials available",
			steps: [{ action: "Update IAM policy binding", data: "policy.json v2", expected: "New permissions effective within 60s" }],
		},
	];
	for (const def of caseDefs) {
		const tc = (await apir.post(`/api/v2/workspaces/${cloud.id}/test-cases`, {
			title: def.title,
			preconditions: def.preconditions,
			priority: "high",
			status: "active",
			estimated_duration: 15,
			folder_id: folder.id,
		})) as { id: number };
		for (const step of def.steps) {
			await apir.post(`/api/v2/workspaces/${cloud.id}/test-cases/${tc.id}/steps`, step);
		}
	}
	const plan = (await apir.post(`/api/v2/workspaces/${cloud.id}/test-plans`, {
		name: "Q3 Edge Release Regression",
		description: "Full regression pass for the Q3 load balancer release",
	})) as { id: number };
	const allCases = (await apir.get(`/api/v2/workspaces/${cloud.id}/test-cases?all=true&page_size=100`)) as Array<{ id: number }>;
	for (const tc of allCases) {
		await apir.post(`/api/v2/workspaces/${cloud.id}/test-plans/${plan.id}/test-cases`, { test_case_id: tc.id });
	}
	const template = (await apir.post(`/api/v2/workspaces/${cloud.id}/test-run-templates`, {
		name: "Standard Regression Template",
		description: "Executes every case in the regression plan",
		plan_id: plan.id,
	})) as { id: number };
	const run = (await apir.post(`/api/v2/workspaces/${cloud.id}/test-runs`, {
		name: "Q3 Edge Release — Regression Pass 1",
		template_id: template.id,
		plan_id: plan.id,
		assignee_id: uniqueUserIds[0],
	})) as { id: number };
	const results = (await apir.get(`/api/v2/workspaces/${cloud.id}/test-runs/${run.id}/results`)) as Array<{ id: number }>;
	const outcomes = ["passed", "passed", "failed", "passed"];
	for (let i = 0; i < results.length; i++) {
		const status = outcomes[i % outcomes.length];
		await apir.patch(`/api/v2/workspaces/${cloud.id}/test-runs/${run.id}/results/${results[i].id}`, {
			status,
			actual_result:
				status === "passed"
					? "Matches expected behavior"
					: "p99 latency spiked to 420ms during certificate rotation",
			notes: status === "failed" ? "Filed CLOUD follow-up for cert rotation regression" : "",
		});
	}
	// The run detail view only renders recorded results once the run is ended.
	await apir.post(`/api/v2/workspaces/${cloud.id}/test-runs/${run.id}/end`);

	// ─── roadmap: render start→due-date bars instead of markers ──────
	await apir.put(`/api/v2/workspaces/${cloud.id}/board-configuration`, {
		roadmap_config: {
			start_field_id: "start_date",
			end_field_id: "due_date",
			dependency_link_type_id: null,
		},
	});

	return {
		cloudWorkspaceId: cloud.id,
		milestoneId: alpha.id,
		pageId: home.id,
		testRunId: run.id,
		featuredItemId: featured.id,
	};
}
