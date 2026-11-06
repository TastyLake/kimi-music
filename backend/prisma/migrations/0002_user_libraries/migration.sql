-- Личные медиатеки: у каждого трека появляется владелец.

-- 1) Колонка владельца (пока допускает NULL, чтобы заполнить существующие строки)
ALTER TABLE "tracks" ADD COLUMN "owner_id" UUID;

-- 2) Уже загруженные треки достаются первому администратору (раньше их добавлял именно он)
UPDATE "tracks"
SET "owner_id" = (SELECT "id" FROM "users" WHERE "role" = 'ADMIN' ORDER BY "created_at" ASC LIMIT 1)
WHERE "owner_id" IS NULL;

-- Если администратора нет, владельца назначить некому — такие строки удаляем (файлы на диске остаются)
DELETE FROM "tracks" WHERE "owner_id" IS NULL;

ALTER TABLE "tracks" ALTER COLUMN "owner_id" SET NOT NULL;

-- 3) Хэш файла теперь уникален в пределах одного пользователя, а не глобально
DROP INDEX "tracks_file_hash_key";
CREATE UNIQUE INDEX "tracks_owner_id_file_hash_key" ON "tracks"("owner_id", "file_hash");
CREATE INDEX "tracks_owner_id_match_key_idx" ON "tracks"("owner_id", "match_key");

ALTER TABLE "tracks"
  ADD CONSTRAINT "tracks_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4) Загружать треки может каждый пользователь (админ по-прежнему может отозвать право)
ALTER TABLE "users" ALTER COLUMN "can_upload" SET DEFAULT true;
UPDATE "users" SET "can_upload" = true;

-- 5) Избранное и плейлисты теперь могут содержать только собственные треки:
--    убираем связи с треками, чьим владельцем стал другой пользователь
DELETE FROM "user_favorites" uf USING "tracks" t
WHERE uf."track_id" = t."id" AND uf."user_id" <> t."owner_id";

DELETE FROM "playlist_tracks" pt USING "tracks" t, "playlists" p
WHERE pt."track_id" = t."id" AND pt."playlist_id" = p."id" AND p."user_id" <> t."owner_id";
