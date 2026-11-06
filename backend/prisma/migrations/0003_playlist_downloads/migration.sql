-- Задачи фонового скачивания недостающих треков при импорте плейлиста.

CREATE TYPE "DownloadStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

CREATE TABLE "playlist_downloads" (
    "id" UUID NOT NULL,
    "playlist_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "artist" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "match_key" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "status" "DownloadStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "track_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "playlist_downloads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "playlist_downloads_status_created_at_idx" ON "playlist_downloads"("status", "created_at");
CREATE INDEX "playlist_downloads_playlist_id_idx" ON "playlist_downloads"("playlist_id");

ALTER TABLE "playlist_downloads" ADD CONSTRAINT "playlist_downloads_playlist_id_fkey" FOREIGN KEY ("playlist_id") REFERENCES "playlists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "playlist_downloads" ADD CONSTRAINT "playlist_downloads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
