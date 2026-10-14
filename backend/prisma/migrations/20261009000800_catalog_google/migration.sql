-- Additive catalog provenance and Google identity; preserves existing records.
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;
ALTER TABLE "users" ADD COLUMN "google_subject" VARCHAR(255);
CREATE UNIQUE INDEX "users_google_subject_key" ON "users"("google_subject");
ALTER TABLE "movies"
  ADD COLUMN "backdrop_url" TEXT,
  ADD COLUMN "collections" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "metadata_source_url" TEXT,
  ADD COLUMN "artwork_kind" VARCHAR(30),
  ADD COLUMN "artwork_attribution" TEXT,
  ADD COLUMN "artwork_source_url" TEXT,
  ADD COLUMN "rating_value" DOUBLE PRECISION,
  ADD COLUMN "rating_vote_count" INTEGER,
  ADD COLUMN "rating_source" VARCHAR(30),
  ADD COLUMN "rating_source_url" TEXT,
  ADD COLUMN "rating_fetched_at" TIMESTAMPTZ(3);
CREATE INDEX "movies_collections_idx" ON "movies" USING GIN("collections");

ALTER TABLE "movies" ADD CONSTRAINT "movies_collection_keys_check" CHECK (
  collections <@ ARRAY['recommended','bollywood','south','popular','picks','featured']::TEXT[]
  AND array_position(collections, NULL) IS NULL
);
ALTER TABLE "movies" ADD CONSTRAINT "movies_metadata_source_check" CHECK (
  metadata_source_url IS NULL OR metadata_source_url ~ '^https://[^[:space:]]+$'
);
ALTER TABLE "movies" ADD CONSTRAINT "movies_rating_provenance_check" CHECK (
  (rating_value IS NULL AND rating_vote_count IS NULL AND rating_source IS NULL AND rating_source_url IS NULL AND rating_fetched_at IS NULL)
  OR
  (rating_value IS NOT NULL AND rating_vote_count IS NOT NULL AND rating_source IS NOT NULL
    AND rating_source_url IS NOT NULL AND rating_fetched_at IS NOT NULL
    AND rating_value >= 0 AND rating_value <= 10 AND rating_vote_count > 0
    AND rating_source = 'TMDB' AND rating_source_url ~ '^https://www[.]themoviedb[.]org/movie/[1-9][0-9]*$')
);
ALTER TABLE "movies" ADD CONSTRAINT "movies_artwork_provenance_check" CHECK (
  (artwork_kind IS NULL AND artwork_attribution IS NULL AND artwork_source_url IS NULL)
  OR
  (artwork_kind IS NOT NULL AND artwork_attribution IS NOT NULL AND length(trim(artwork_attribution)) > 0
    AND (
      (artwork_kind = 'ILLUSTRATION' AND artwork_source_url IS NULL AND (poster_url IS NOT NULL OR backdrop_url IS NOT NULL)
        AND (poster_url IS NULL OR poster_url ~ '^/demo-art/[a-z0-9]+(-[a-z0-9]+)*-poster[.]svg$')
        AND (backdrop_url IS NULL OR backdrop_url ~ '^/demo-art/[a-z0-9]+(-[a-z0-9]+)*-backdrop[.]svg$'))
      OR
      (artwork_kind = 'TMDB' AND artwork_source_url IS NOT NULL
        AND artwork_source_url ~ '^https://www[.]themoviedb[.]org/movie/[1-9][0-9]*$'
        AND poster_url IS NOT NULL AND backdrop_url IS NOT NULL
        AND poster_url ~ '^https://image[.]tmdb[.]org/t/p/w500/[A-Za-z0-9]+[.]jpg$'
        AND backdrop_url ~ '^https://image[.]tmdb[.]org/t/p/w1280/[A-Za-z0-9]+[.]jpg$')
    ))
);
