import fs from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { prisma } from '../lib/prisma.js';

export async function ensureDirs(): Promise<void> {
  await Promise.all([config.MUSIC_DIR, config.COVERS_DIR, config.TMP_DIR, config.DOWNLOAD_DIR].map((d) => fs.mkdir(d, { recursive: true })));
  // Хвосты прерванных загрузок
  const leftovers = await fs.readdir(config.TMP_DIR).catch(() => [] as string[]);
  await Promise.all(leftovers.map((f) => fs.rm(`${config.TMP_DIR}/${f}`, { force: true })));
}

/** Создаёт администратора из ADMIN_* переменных, если в базе ещё нет ни одного ADMIN. */
export async function ensureAdmin(): Promise<void> {
  if (!config.ADMIN_EMAIL || !config.ADMIN_PASSWORD) return;
  if ((await prisma.user.count({ where: { role: 'ADMIN' } })) > 0) return;

  const email = config.ADMIN_EMAIL.toLowerCase();
  const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { username: config.ADMIN_USERNAME }] } });
  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data: { role: 'ADMIN', canUpload: true, isBlocked: false } });
    console.log(`[bootstrap] пользователь ${existing.username} назначен администратором`);
    return;
  }
  await prisma.user.create({
    data: {
      username: config.ADMIN_USERNAME,
      email,
      passwordHash: await bcrypt.hash(config.ADMIN_PASSWORD, 11),
      role: 'ADMIN',
      canUpload: true,
    },
  });
  console.log(`[bootstrap] создан администратор ${config.ADMIN_USERNAME}`);
}
