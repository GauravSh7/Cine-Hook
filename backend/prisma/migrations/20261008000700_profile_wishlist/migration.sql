ALTER TABLE "users" ADD COLUMN "date_of_birth" DATE,
  ADD COLUMN "phone" VARCHAR(20),
  ADD COLUMN "avatar_url" TEXT,
  ADD COLUMN "avatar_public_id" TEXT;

CREATE TABLE "movie_wishlists" (
  "user_id" UUID NOT NULL,
  "movie_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "movie_wishlists_pkey" PRIMARY KEY ("user_id", "movie_id"),
  CONSTRAINT "movie_wishlists_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "movie_wishlists_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "movie_wishlists_user_id_created_at_movie_id_idx" ON "movie_wishlists"("user_id", "created_at", "movie_id");
