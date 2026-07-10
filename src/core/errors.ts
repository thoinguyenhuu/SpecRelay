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
