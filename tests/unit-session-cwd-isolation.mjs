// Regression test for concurrent-turn cross-talk: the bridge keyed its Claude CLI
// session pointer on a single module-global, so two turns running concurrently in
// one daemon (each in its own git-worktree cwd) collapsed onto one CLI session —
// the second task resumed the first task's conversation. The pointer is now keyed
// per cwd. These tests assert that distinct cwds never share or clobber state.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
	__testSetSharedSessionForCwd,
	__testGetSharedSessionForCwd,
	__testClearSharedSessions,
	reportToolResultMismatch,
} from "../src/index.js";

const A = "/tmp/wt-card-a";
const B = "/tmp/wt-card-b";

function mismatchCtx() {
	// Minimal QueryContext-like shape that reports a mismatch exactly once.
	let reported = false;
	return {
		get reportedToolResultMismatch() { return reported; },
		set reportedToolResultMismatch(v) { reported = v; },
		activeQuery: null,
		toolResultProgress: () => ({
			expectedCount: 2, deliveredCount: 2, resolvedCount: 1,
			waitingCount: 0, queuedCount: 1, unmatchedResultCount: 0,
			unresolvedIds: ["t1"], queuedIds: ["t1"], toolNames: [{ name: "bash", count: 1 }],
		}),
	};
}

describe("per-cwd session isolation", () => {
	beforeEach(() => __testClearSharedSessions());

	it("stores independent sessions per cwd", () => {
		__testSetSharedSessionForCwd(A, { sessionId: "aaaaaaaa-1111", cursor: 3, cwd: A });
		__testSetSharedSessionForCwd(B, { sessionId: "bbbbbbbb-2222", cursor: 7, cwd: B });

		assert.equal(__testGetSharedSessionForCwd(A)?.sessionId, "aaaaaaaa-1111");
		assert.equal(__testGetSharedSessionForCwd(B)?.sessionId, "bbbbbbbb-2222");
		assert.equal(__testGetSharedSessionForCwd(A)?.cursor, 3);
		assert.equal(__testGetSharedSessionForCwd(B)?.cursor, 7);
	});

	it("marking one cwd's session for rebuild does not touch another cwd", () => {
		__testSetSharedSessionForCwd(A, { sessionId: "aaaaaaaa-1111", cursor: 3, cwd: A });
		__testSetSharedSessionForCwd(B, { sessionId: "bbbbbbbb-2222", cursor: 7, cwd: B });

		// Simulate a tool-result mismatch on card A's turn only.
		reportToolResultMismatch(mismatchCtx(), "query teardown", A);

		assert.equal(__testGetSharedSessionForCwd(A)?.needsRebuild, true);
		assert.equal(__testGetSharedSessionForCwd(B)?.needsRebuild, undefined, "card B must be unaffected");
		assert.equal(__testGetSharedSessionForCwd(B)?.sessionId, "bbbbbbbb-2222");
	});

	it("clearing one cwd leaves the other intact", () => {
		__testSetSharedSessionForCwd(A, { sessionId: "aaaaaaaa-1111", cursor: 3, cwd: A });
		__testSetSharedSessionForCwd(B, { sessionId: "bbbbbbbb-2222", cursor: 7, cwd: B });

		__testSetSharedSessionForCwd(A, null);

		assert.equal(__testGetSharedSessionForCwd(A), null);
		assert.equal(__testGetSharedSessionForCwd(B)?.sessionId, "bbbbbbbb-2222");
	});
});
