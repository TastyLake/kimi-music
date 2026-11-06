import path from 'node:path';
import { config } from '../config.js';
import { prisma } from './prisma.js';
import type { AuthUser } from '../middleware/auth.js';

export function userMusicDir(userId: string): string {
  return path.join(config.MUSIC_DIR, 'users', userId);
}

export function isInsideMusicDir(filePath: string): boolean {
  const root = config.MUSIC_DIR + path.sep;
  return filePath === config.MUSIC_DIR || filePath.startsWith(root);
}

export async function canStreamTrack(user: AuthUser, trackId: string): Promise<boolean> {
  const track = await prisma.track.findUnique({ where: { id: trackId }, select: { ownerId: true } });
  if (!track) return false;
  if (user.role === 'ADMIN' || track.ownerId === user.id) return true;
  const shared = await prisma.playlistTrack.findFirst({
    where: { trackId, playlist: { isPublic: true } },
    select: { playlistId: true },
  });
  return Boolean(shared);
}

export async function loadOwnedTrack(user: AuthUser, trackId: string, adminBypass = true) {
  const track = await prisma.track.findUnique({ where: { id: trackId } });
  if (!track) return null;
  if (track.ownerId === user.id || (adminBypass && user.role === 'ADMIN')) return track;
  return null;
}
