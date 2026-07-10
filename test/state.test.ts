import { describe, expect, it } from "vitest";

import { SpecRelayError } from "../src/core/errors.js";
import {
  runEvents,
  runStates,
  transition,
  type RunEvent,
  type RunState
} from "../src/core/state.js";

const allowedTransitions: Readonly<
  Record<RunState, Readonly<Partial<Record<RunEvent, RunState>>>>
> = {
  draft_plan: { submit_plan: "awaiting_approval", cancel: "cancelled" },
  awaiting_approval: { approve_plan: "approved", cancel: "cancelled" },
  approved: { start_implementation: "implementing", cancel: "cancelled" },
  implementing: {
    implementation_succeeded: "checking",
    implementation_failed: "failed",
    execution_interrupted: "interrupted",
    cancel: "cancelled"
  },
  checking: {
    checks_succeeded: "ready_for_review",
    checks_failed: "failed",
    execution_interrupted: "interrupted",
    cancel: "cancelled"
  },
  ready_for_review: {
    review_completed: "complete",
    request_fixes: "fixing",
    mark_needs_human: "needs_human",
    cancel: "cancelled"
  },
  fixing: {
    fixes_completed: "checking",
    implementation_failed: "failed",
    execution_interrupted: "interrupted",
    cancel: "cancelled"
  },
  interrupted: { mark_needs_human: "needs_human", cancel: "cancelled" },
  complete: {},
  needs_human: {},
  failed: {},
  cancelled: {}
};

describe("state machine", () => {
  it("allows every documented transition and preserves extra snapshot fields", () => {
    for (const state of runStates) {
      for (const [event, nextState] of Object.entries(allowedTransitions[state])) {
        const result = transition({ id: "run-123", state }, event as RunEvent);
        expect(result).toEqual({ id: "run-123", state: nextState });
      }
    }
  });

  it("rejects every undocumented transition with a stable error code", () => {
    for (const state of runStates) {
      for (const event of runEvents) {
        if (allowedTransitions[state][event] !== undefined) {
          continue;
        }

        expect(() => transition({ state }, event)).toThrowError(SpecRelayError);
        try {
          transition({ state }, event);
        } catch (error) {
          expect(error).toMatchObject({ code: "INVALID_STATE_TRANSITION" });
        }
      }
    }
  });
});
