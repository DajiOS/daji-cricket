export class HttpError extends Error {
  status: number;
  code: string;
  details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export const notFound = (what = 'Not found') => new HttpError(404, 'NOT_FOUND', what);
export const forbidden = (msg = 'You do not have access to this') => new HttpError(403, 'FORBIDDEN', msg);
export const conflict = (code: string, msg: string, details?: unknown) => new HttpError(409, code, msg, details);
export const bad = (code: string, msg: string, details?: unknown) => new HttpError(400, code, msg, details);
