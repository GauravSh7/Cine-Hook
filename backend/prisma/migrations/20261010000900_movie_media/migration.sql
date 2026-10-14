ALTER TABLE "movies"
  ADD COLUMN "description_hindi" TEXT,
  ADD COLUMN "trailer_video_id" VARCHAR(11),
  ADD COLUMN "trailer_source_url" TEXT,
  ADD COLUMN "trailer_verified_at" TIMESTAMPTZ(3);
ALTER TABLE "movies" ADD CONSTRAINT "movies_trailer_evidence_check" CHECK (
  (trailer_video_id IS NULL AND trailer_source_url IS NULL AND trailer_verified_at IS NULL)
  OR (trailer_video_id IS NOT NULL AND trailer_source_url IS NOT NULL
    AND trailer_video_id ~ '^[A-Za-z0-9_-]{11}$'
    AND trailer_source_url ~ '^https://www\.themoviedb\.org/movie/[0-9]+$'
    AND trailer_verified_at IS NOT NULL)
);
