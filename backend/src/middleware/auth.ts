import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Role } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/http.js';
import { verifyAccessToken } from '../lib/tokens.js';

export interface AuthUser {
  id: string;
  username: string;
  role: Role;
  canUpload: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

interface AuthOptions {
  /** Разрешить токен в ?token= (нужно для <audio>) и долгоживущий stream-токен */
  forStreaming?: boolean;
}

export function authenticate(opts: AuthOptions = {}): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    let token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token && opts.forStreaming && typeof req.query.token === 'string') token = req.query.token;
    if (!token) throw new HttpError(401, 'unauthorized', 'Требуется вход');

    const payload = verifyAccessToken(token);
    const typeOk = payload && (payload.typ === 'access' || (opts.forStreaming && payload.typ === 'stream'));
    if (!payload || !typeOk) throw new HttpError(401, 'invalid_token', 'Токен недействителен или истёк');

    // Каждый запрос сверяем с БД, чтобы блокировка/смена роли действовали сразу
    const user = await prisma.user.findUnique({
      where: { id: payload.sub! },
      select: { id: true, username: true, role: true, canUpload: true, isBlocked: true },
    });
    if (!user) throw new HttpError(401, 'invalid_token', 'Пользователь не найден');
    if (user.isBlocked) throw new HttpError(403, 'account_blocked', 'Аккаунт заблокирован администратором');

    req.user = { id: user.id, username: user.username, role: user.role, canUpload: user.canUpload };
    next();
  };
}

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (req.user?.role !== 'ADMIN') throw new HttpError(403, 'forbidden', 'Только для администратора');
  next();
};

export const requireUploader: RequestHandler = (req, _res, next) => {
  if (req.user?.role !== 'ADMIN' && !req.user?.canUpload) {
    throw new HttpError(403, 'upload_forbidden', 'У вас нет прав на загрузку треков');
  }
  next();
};

export function me(req: Request): AuthUser {
  if (!req.user) throw new HttpError(401, 'unauthorized', 'Требуется вход');
  return req.user;
}
