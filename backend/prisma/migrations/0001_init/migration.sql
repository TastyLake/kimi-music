-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "TrackStatus" AS ENUM ('PARSED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'FULFILLED', 'REJECTED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "can_upload" BOOLEAN NOT NULL DEFAULT false,
    "is_blocked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracks" (
    "id" UUID NOT NULL,
    "file_path" TEXT NOT NULL,
    "file_hash" TEXT NOT NULL,
    "file_size" BIGINT NOT NULL,
    "file_mtime_ms" BIGINT NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "album" TEXT,
    "year" INTEGER,
    "duration" INTEGER NOT NULL DEFAULT 0,
    "cover_image_url" TEXT,
    "match_key" TEXT NOT NULL,
    "status" "TrackStatus" NOT NULL DEFAULT 'PARSED',
    "enriched_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "genres" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "genres_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "track_genres" (
    "track_id" UUID NOT NULL,
    "genre_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "track_genres_pkey" PRIMARY KEY ("track_id","genre_id")
);

-- CreateTable
CREATE TABLE "playlists" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "cover_image" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "playlists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playlist_tracks" (
    "playlist_id" UUID NOT NULL,
    "track_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "playlist_tracks_pkey" PRIMARY KEY ("playlist_id","track_id")
);

-- CreateTable
CREATE TABLE "user_favorites" (
    "user_id" UUID NOT NULL,
    "track_id" UUID NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_favorites_pkey" PRIMARY KEY ("user_id","track_id")
);

-- CreateTable
CREATE TABLE "track_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "artist" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "match_key" TEXT NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "track_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tracks_file_path_key" ON "tracks"("file_path");

-- CreateIndex
CREATE UNIQUE INDEX "tracks_file_hash_key" ON "tracks"("file_hash");

-- CreateIndex
CREATE INDEX "tracks_match_key_idx" ON "tracks"("match_key");

-- CreateIndex
CREATE INDEX "tracks_artist_idx" ON "tracks"("artist");

-- CreateIndex
CREATE INDEX "tracks_created_at_idx" ON "tracks"("created_at");

-- CreateIndex
CREATE INDEX "tracks_status_idx" ON "tracks"("status");

-- CreateIndex
CREATE UNIQUE INDEX "genres_name_key" ON "genres"("name");

-- CreateIndex
CREATE INDEX "track_genres_genre_id_idx" ON "track_genres"("genre_id");

-- CreateIndex
CREATE INDEX "playlists_user_id_idx" ON "playlists"("user_id");

-- CreateIndex
CREATE INDEX "playlist_tracks_playlist_id_position_idx" ON "playlist_tracks"("playlist_id", "position");

-- CreateIndex
CREATE INDEX "user_favorites_user_id_added_at_idx" ON "user_favorites"("user_id", "added_at");

-- CreateIndex
CREATE INDEX "track_requests_status_idx" ON "track_requests"("status");

-- CreateIndex
CREATE INDEX "track_requests_match_key_idx" ON "track_requests"("match_key");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "track_genres" ADD CONSTRAINT "track_genres_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "track_genres" ADD CONSTRAINT "track_genres_genre_id_fkey" FOREIGN KEY ("genre_id") REFERENCES "genres"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlists" ADD CONSTRAINT "playlists_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_tracks" ADD CONSTRAINT "playlist_tracks_playlist_id_fkey" FOREIGN KEY ("playlist_id") REFERENCES "playlists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_tracks" ADD CONSTRAINT "playlist_tracks_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_favorites" ADD CONSTRAINT "user_favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_favorites" ADD CONSTRAINT "user_favorites_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "track_requests" ADD CONSTRAINT "track_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
