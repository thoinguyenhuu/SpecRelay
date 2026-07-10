import { SpecRelayError } from "./errors.js";

export const runStates = [
  "draft_plan",
  "awaiting_approval",
  "approved",
  "implementing",
  "checking",
  "ready_for_review",
  "fixing",
  "complete",
  "needs_human",
  "failed",
  "interrupted",
  "cancelled"
] as const;

export type RunState = (typeof runStates)[number];

export const runEvents = [
  "submit_plan",
  "approve_plan",
  "start_implementation",
  "implementation_succeeded",
  "implementation_failed",
  "execution_interrupted",
  "checks_succeeded",
  "checks_failed",
  "review_completed",
  "request_fixes",
  "fixes_completed",
  "mark_needs_human",
  "cancel"
] as const;

export type RunEvent = (typeof runEvents)[number];

export interface RunStateSnapshot {
  readonly state: RunState;
}

const transitions: Readonly<Record<RunState, Readonly<Partial<Record<RunEvent, RunState>>>>> = {
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

export function transition<T extends RunStateSnapshot>(
  run: T,
  event: RunEvent
): Omit<T, "state"> & RunStateSnapshot {
  const nextState = transitions[run.state][event];

  if (nextState === undefined) {
    throw new SpecRelayError(
      "INVALID_STATE_TRANSITION",
      `Cannot apply event '${event}' while run is '${run.state}'.`,
      { currentState: run.state, event }
    );
  }

  return { ...run, state: nextState };
}
