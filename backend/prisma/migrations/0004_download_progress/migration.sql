ALTER TYPE "DownloadStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

ALTER TABLE "playlist_downloads" ADD COLUMN "progress" INTEGER;
