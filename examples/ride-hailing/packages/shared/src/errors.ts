import { logger } from './logger';
export class AppError extends Error {
  constructor(message: string, public status = 500) {
    super(message);
    logger.error(message, { status });
  }
}
export class NotFound extends AppError {
  constructor(what: string) { super(`${what} not found`, 404); }
}
