// Regression test for DST-6144: three cards on one daemon must keep separate
// Claude CLI sessions.
//
// The bridge keyed its session pointer on `options.cwd ?? process.cwd()`. Pi's
// StreamOptions carries no cwd, so every concurrent turn in one daemon resolved
// to the SAME process.cwd() key and collapsed onto one CLI session — the second
// (and third) card resumed the first card's conversation. The pointer is now
// keyed on the per-task Pi session id (options.sessionId). These tests assert
// that three cards sharing one process cwd never share or clobber each other's
// session, and that a card's follow-up turn resumes its OWN session.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
	sharedSessionKeyFor,
	__testSetSharedSessionForCwd,
	__testGetSharedSessionForCwd,
	__testClearSharedSessions,
} from "../src/index.js";

// All three cards run in ONE daemon process, so process.cwd() is identical for
// every turn — exactly the condition that used to collapse them onto one key.
const DAEMON_CWD = "/home/worker";
const CARDS = [
	{ name: "list-mover", sessionId: "pi-sess-aaaa", claude: "claude-aaaa", worktree: "/home/worker/.manta/worktrees/list-mover-1" },
	{ name: "crm-screen", sessionId: "pi-sess-bbbb", claude: "claude-bbbb", worktree: "/home/worker/.manta/worktrees/crm-screen-2" },
	{ name: "manta-card", sessionId: "pi-sess-cccc", claude: "claude-cccc", worktree: "/home/worker/.manta/worktrees/manta-card-3" },
];

// What the stream entry computes: storeKey = sharedSessionKeyFor(options.sessionId, cwd).
const storeKeyFor = (card) => sharedSessionKeyFor(card.sessionId, DAEMON_CWD);

describe("per-task session isolation across three cards (DST-6144)", () => {
	beforeEach(() => __testClearSharedSessions());

	it("derives a distinct store key per card despite one shared process cwd", () => {
		const keys = CARDS.map(storeKeyFor);
		assert.equal(new Set(keys).size, 3, "three cards must produce three distinct keys");
		// The old keying (cwd ?? process.cwd()) would have produced one shared key.
		const oldKeys = CARDS.map(() => sharedSessionKeyFor(undefined, DAEMON_CWD));
		assert.equal(new Set(oldKeys).size, 1, "sanity: cwd-only keying collapses to one (the bug)");
	});

	it("keeps three concurrent cards' sessions independent", () => {
		// Each card's turn writes its own Claude session under its own key.
		for (const card of CARDS) {
			__testSetSharedSessionForCwd(storeKeyFor(card), {
				sessionId: card.claude,
				cursor: 1,
				cwd: card.worktree,
			});
		}
		// Every card still sees ITS OWN session — no cross-resume.
		for (const card of CARDS) {
			const got = __testGetSharedSessionForCwd(storeKeyFor(card));
			assert.equal(got?.sessionId, card.claude, `${card.name} must resume its own Claude session`);
			assert.equal(got?.cwd, card.worktree, `${card.name} must keep its own worktree`);
		}
	});

	it("a follow-up turn resumes the card's own session, never a sibling's", () => {
		for (const card of CARDS) {
			__testSetSharedSessionForCwd(storeKeyFor(card), { sessionId: card.claude, cursor: 2, cwd: card.worktree });
		}
		// list-mover takes another turn (same sessionId) — must NOT pick up crm-screen.
		const followUp = __testGetSharedSessionForCwd(storeKeyFor(CARDS[0]));
		assert.equal(followUp?.sessionId, "claude-aaaa");
		assert.notEqual(followUp?.sessionId, "claude-bbbb");
		assert.notEqual(followUp?.sessionId, "claude-cccc");
	});

	it("clearing one card's session leaves the other two intact", () => {
		for (const card of CARDS) {
			__testSetSharedSessionForCwd(storeKeyFor(card), { sessionId: card.claude, cursor: 1, cwd: card.worktree });
		}
		__testSetSharedSessionForCwd(storeKeyFor(CARDS[1]), null); // crm-screen disposed
		assert.equal(__testGetSharedSessionForCwd(storeKeyFor(CARDS[1])), null);
		assert.equal(__testGetSharedSessionForCwd(storeKeyFor(CARDS[0]))?.sessionId, "claude-aaaa");
		assert.equal(__testGetSharedSessionForCwd(storeKeyFor(CARDS[2]))?.sessionId, "claude-cccc");
	});
});
