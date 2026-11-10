import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { config } from '../config.js';
import { prisma } from './prisma.js';
import { HttpError } from './http.js';

type Expires = jwt.SignOptions['expiresIn'];

export type TokenType = 'access' | 'stream' | 'refresh';

export interface TokenPayload extends jwt.JwtPayload {
  typ: TokenType;
  role?: Role;
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export function signAccess(userId: string, role: Role): string {
  return jwt.sign({ typ: 'access', role }, config.JWT_ACCESS_SECRET, {
    subject: userId,
    expiresIn: config.ACCESS_TTL as Expires,
  });
}

/** Долгоживущий токен только для стриминга: <audio src="...?token="> не умеет заголовки. */
export function signStream(userId: string, role: Role): string {
  return jwt.sign({ typ: 'stream', role }, config.JWT_ACCESS_SECRET, {
    subject: userId,
    expiresIn: '6h' as Expires,
  });
}

export function verifyAccessToken(token: string): TokenPayload | null {
  try {
    const d = jwt.verify(token, config.JWT_ACCESS_SECRET);
    if (typeof d === 'string' || !d.sub) return null;
    return d as TokenPayload;
  } catch {
    return null;
  }
}

export async function issueRefresh(userId: string): Promise<string> {
  const token = jwt.sign({ typ: 'refresh', jti: crypto.randomUUID() }, config.JWT_REFRESH_SECRET, {
    subject: userId,
    expiresIn: `${config.REFRESH_TTL_DAYS}d` as Expires,
  });
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + config.REFRESH_TTL_DAYS * 86_400_000),
    },
  });
  return token;
}

/** Проверяет refresh-токен и «сжигает» его (ротация). Возвращает userId. */
export async function consumeRefresh(token: string): Promise<string> {
  let payload: jwt.JwtPayload | string;
  try {
    payload = jwt.verify(token, config.JWT_REFRESH_SECRET);
  } catch {
    throw new HttpError(401, 'invalid_refresh', 'Сессия истекла, войдите заново');
  }
  if (typeof payload === 'string' || payload.typ !== 'refresh' || !payload.sub) {
    throw new HttpError(401, 'invalid_refresh', 'Сессия истекла, войдите заново');
  }
  const deleted = await prisma.refreshToken.deleteMany({ where: { tokenHash: sha256(token) } });
  if (deleted.count === 0) throw new HttpError(401, 'invalid_refresh', 'Сессия отозвана, войдите заново');
  return payload.sub;
}

export async function revokeRefresh(token: string): Promise<void> {
  await prisma.refreshToken.deleteMany({ where: { tokenHash: sha256(token) } });
}

export async function purgeExpiredRefresh(): Promise<void> {
  await prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}
