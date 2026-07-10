export const errorCodes = [
  "USAGE",
  "UNSUPPORTED_RUNTIME",
  "DEPENDENCY_NOT_FOUND",
  "NOT_A_GIT_REPOSITORY",
  "INVALID_CONFIG",
  "CONFIG_ALREADY_EXISTS",
  "ARTIFACT_DIRECTORY_COLLISION",
  "RUN_NOT_FOUND",
  "INVALID_PLAN",
  "OPEN_BLOCKING_QUESTIONS",
  "APPROVAL_CONFIRMATION_REQUIRED",
  "PLAN_CHANGED_AFTER_APPROVAL",
  "RUN_LOCKED",
  "IMPLEMENT_CONFIRMATION_REQUIRED",
  "CANCEL_CONFIRMATION_REQUIRED",
  "CLEANUP_CONFIRMATION_REQUIRED",
  "RUN_NOT_APPROVED",
  "BASE_REPOSITORY_DIRTY",
  "GIT_WORKTREE_UNAVAILABLE",
  "CLAUDE_NOT_FOUND",
  "EXECUTION_ALREADY_EXISTS",
  "INVALID_EXECUTION",
  "UNSAFE_WORKTREE_PATH",
  "WORKTREE_NOT_CLEAN",
  "EXECUTION_NOT_RUNNING",
  "NO_CHECKS_CONFIGURED",
  "CHECKS_NOT_READY",
  "INVALID_CHECK_COMMAND",
  "INVALID_CHECKS",
  "INVALID_STATE_TRANSITION",
  "PLUGIN_MANIFEST_INVALID",
  "INTERNAL_ERROR"
] as const;

export type ErrorCode = (typeof errorCodes)[number];

export class SpecRelayError extends Error {
  readonly code: ErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(code: ErrorCode, message: string, details?: Readonly<Record<string, unknown>>) {
    super(message);
    this.name = "SpecRelayError";
    this.code = code;

    if (details !== undefined) {
      this.details = details;
    }
  }
}

export function isSpecRelayError(error: unknown): error is SpecRelayError {
  return error instanceof SpecRelayError;
}
