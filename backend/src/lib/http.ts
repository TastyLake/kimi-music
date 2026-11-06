import type { ErrorRequestHandler, Request } from 'express';
import multer from 'multer';
import { z } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message ?? code);
  }
}

export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    throw new HttpError(400, 'validation_error', msg);
  }
  return r.data;
}

const uuidSchema = z.string().uuid();
export function uuid(value: unknown, name = 'id'): string {
  const r = uuidSchema.safeParse(value);
  if (!r.success) throw new HttpError(400, 'validation_error', `${name}: некорректный идентификатор`);
  return r.data;
}

/** query-параметры без пустых строк (иначе coerce превращает '' в 0 / Invalid Date) */
export function cleanQuery(req: Request): Record<string, unknown> {
  return Object.fromEntries(Object.entries(req.query).filter(([, v]) => v !== '' && v !== undefined));
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  // Защита: если заголовки уже отправлены клиенту, передаём обработку стандартному handler Express
  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.code, message: err.message, ...err.extra });
    return;
  }
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: 'validation_error', message: err.issues.map((i) => i.message).join('; ') });
    return;
  }
  if (err instanceof multer.MulterError) {
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    res.status(tooBig ? 413 : 400).json({
      error: tooBig ? 'file_too_large' : 'upload_error',
      message: tooBig ? 'Файл слишком большой' : err.message,
    });
    return;
  }
  if (err && typeof err === 'object' && 'type' in err && (err as { type?: string }).type === 'entity.parse.failed') {
    res.status(400).json({ error: 'bad_json', message: 'Некорректный JSON' });
    return;
  }
  console.error('[error]', err);
  res.status(500).json({ error: 'internal_error', message: 'Внутренняя ошибка сервера' });
};