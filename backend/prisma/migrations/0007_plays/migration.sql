-- CreateTable
CREATE TABLE "plays" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "track_id" UUID NOT NULL,
    "artist" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "plays_user_id_artist_idx" ON "plays"("user_id", "artist");

-- CreateIndex
CREATE INDEX "plays_user_id_created_at_idx" ON "plays"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "plays" ADD CONSTRAINT "plays_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
