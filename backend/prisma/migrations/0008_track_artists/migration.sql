-- CreateTable
CREATE TABLE "track_artists" (
    "track_id" UUID NOT NULL,
    "artist_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "track_artists_pkey" PRIMARY KEY ("track_id","artist_id")
);

-- CreateIndex
CREATE INDEX "track_artists_artist_id_idx" ON "track_artists"("artist_id");

-- AddForeignKey
ALTER TABLE "track_artists" ADD CONSTRAINT "track_artists_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "track_artists" ADD CONSTRAINT "track_artists_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "artists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
