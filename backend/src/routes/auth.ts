import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { User } from '@prisma/client';
import { config } from '../config.js';
import { prisma } from '../lib/prisma.js';
import { HttpError, parse } from '../lib/http.js';
import { serializeUser } from '../lib/serialize.js';
import { consumeRefresh, issueRefresh, purgeExpiredRefresh, revokeRefresh, signAccess, signStream } from '../lib/tokens.js';
import { authenticate, me } from '../middleware/auth.js';

export const authRouter = Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'too_many_requests', message: 'Слишком много попыток, попробуйте позже' },
});

async function session(user: User) {
  return {
    user: serializeUser(user),
    accessToken: signAccess(user.id, user.role),
    refreshToken: await issueRefresh(user.id),
    streamToken: signStream(user.id, user.role),
  };
}

const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[\p{L}\p{N}_.-]+$/u, 'допустимы буквы, цифры и символы _ . -'),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, 'минимум 8 символов').max(128),
});

authRouter.post('/register', limiter, async (req, res) => {
  if (!config.ALLOW_REGISTRATION) throw new HttpError(403, 'registration_closed', 'Регистрация закрыта');
  const body = parse(registerSchema, req.body);

  const taken = await prisma.user.findFirst({
    where: { OR: [{ username: { equals: body.username, mode: 'insensitive' } }, { email: body.email }] },
    select: { id: true },
  });
  if (taken) throw new HttpError(409, 'user_exists', 'Имя пользователя или email уже заняты');

  const isFirst = (await prisma.user.count()) === 0; // первый пользователь становится администратором
  const user = await prisma.user.create({
    data: {
      username: body.username,
      email: body.email,
      passwordHash: await bcrypt.hash(body.password, 11),
      role: isFirst ? 'ADMIN' : 'USER',
      canUpload: true,
    },
  });
  res.status(201).json(await session(user));
});

const loginSchema = z.object({ login: z.string().trim().min(1), password: z.string().min(1) });
// Хэш-«пустышка», чтобы время ответа не выдавало, существует ли пользователь
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 11);

authRouter.post('/login', limiter, async (req, res) => {
  const { login, password } = parse(loginSchema, req.body);
  const user = await prisma.user.findFirst({
    where: { OR: [{ email: login.toLowerCase() }, { username: { equals: login, mode: 'insensitive' } }] },
  });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, 'bad_credentials', 'Неверный логин или пароль');
  if (user.isBlocked) throw new HttpError(403, 'account_blocked', 'Аккаунт заблокирован администратором');

  void purgeExpiredRefresh().catch(() => undefined);
  res.json(await session(user));
});

const refreshSchema = z.object({ refreshToken: z.string().min(10) });

authRouter.post('/refresh', async (req, res) => {
  const { refreshToken } = parse(refreshSchema, req.body);
  const userId = await consumeRefresh(refreshToken);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new HttpError(401, 'invalid_refresh', 'Пользователь не найден');
  if (user.isBlocked) throw new HttpError(403, 'account_blocked', 'Аккаунт заблокирован администратором');
  res.json(await session(user));
});

authRouter.post('/logout', async (req, res) => {
  const body = refreshSchema.safeParse(req.body);
  if (body.success) await revokeRefresh(body.data.refreshToken);
  res.status(204).end();
});

authRouter.get('/me', authenticate(), async (req, res) => {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: me(req).id } });
  res.json({ user: serializeUser(u) });
});

authRouter.get('/stream-token', authenticate(), (req, res) => {
  const u = me(req);
  res.json({ streamToken: signStream(u.id, u.role) });
});
