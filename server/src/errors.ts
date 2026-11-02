/** An error whose message is safe to show to the person using the app. */
export class ApiError extends Error {
  status: number;
  code: string;
  field: string | undefined;
  constructor(status: number, code: string, message: string, field?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

export const badRequest = (message: string, field?: string) => new ApiError(400, "invalid", message, field);
export const unauthorized = (message = "Sign in to continue") => new ApiError(401, "unauthorized", message);
export const forbidden = (message = "You don't have access to that") => new ApiError(403, "forbidden", message);
export const notFound = (message = "That doesn't exist anymore") => new ApiError(404, "not_found", message);
export const conflict = (message: string, field?: string) => new ApiError(409, "conflict", message, field);
export const tooMany = (message = "Too many attempts. Try again in a few minutes.") => new ApiError(429, "rate_limited", message);
