-- CreateTable
CREATE TABLE "artists" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "image_url" TEXT,
    "itunes_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "albums" (
    "id" UUID NOT NULL,
    "artist_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "year" INTEGER,
    "cover_url" TEXT,
    "itunes_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "albums_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "track_downloads" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "artist" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "album" TEXT,
    "cover_url" TEXT,
    "match_key" TEXT NOT NULL,
    "status" "DownloadStatus" NOT NULL DEFAULT 'PENDING',
    "progress" INTEGER,
    "error" TEXT,
    "track_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "track_downloads_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "tracks" ADD COLUMN "artist_id" UUID,
ADD COLUMN "album_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "artists_slug_key" ON "artists"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "artists_itunes_id_key" ON "artists"("itunes_id");

-- CreateIndex
CREATE INDEX "artists_name_idx" ON "artists"("name");

-- CreateIndex
CREATE INDEX "albums_title_idx" ON "albums"("title");

-- CreateIndex
CREATE UNIQUE INDEX "albums_artist_id_slug_key" ON "albums"("artist_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "albums_itunes_id_key" ON "albums"("itunes_id");

-- CreateIndex
CREATE INDEX "tracks_artist_id_idx" ON "tracks"("artist_id");

-- CreateIndex
CREATE INDEX "tracks_album_id_idx" ON "tracks"("album_id");

-- CreateIndex
CREATE INDEX "track_downloads_user_id_match_key_idx" ON "track_downloads"("user_id", "match_key");

-- CreateIndex
CREATE INDEX "track_downloads_status_created_at_idx" ON "track_downloads"("status", "created_at");

-- AddForeignKey
ALTER TABLE "albums" ADD CONSTRAINT "albums_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "artists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "artists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_album_id_fkey" FOREIGN KEY ("album_id") REFERENCES "albums"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "track_downloads" ADD CONSTRAINT "track_downloads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
