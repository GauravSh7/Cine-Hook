CREATE TYPE "DemoListingKind" AS ENUM ('STREAM', 'EVENTS', 'SPORTS', 'ACTIVITIES');
CREATE TABLE "demo_listings" (
  "id" UUID NOT NULL,
  "slug" VARCHAR(100) NOT NULL,
  "kind" "DemoListingKind" NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "description" TEXT NOT NULL,
  "category" VARCHAR(60) NOT NULL,
  "city_name" VARCHAR(100),
  "venue_name" VARCHAR(150),
  "starts_at" TIMESTAMPTZ(3),
  "duration_minutes" INTEGER,
  "image_url" TEXT NOT NULL,
  "image_attribution" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "demo_listings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "demo_listing_duration_check" CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 1440)
);
CREATE UNIQUE INDEX "demo_listings_slug_key" ON "demo_listings"("slug");
CREATE INDEX "demo_listings_kind_is_active_category_id_idx" ON "demo_listings"("kind", "is_active", "category", "id");
