CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE "movies" (
    "id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "release_date" DATE NOT NULL,
    "language" VARCHAR(50) NOT NULL,
    "genres" TEXT[],
    "poster_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "movies_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "movies_duration_valid" CHECK ("duration_minutes" BETWEEN 1 AND 600),
    CONSTRAINT "movies_genres_valid" CHECK ("genres" IS NOT NULL AND cardinality("genres") BETWEEN 1 AND 10),
    CONSTRAINT "movies_title_valid" CHECK (length(btrim("title")) > 0),
    CONSTRAINT "movies_description_valid" CHECK (length(btrim("description")) BETWEEN 1 AND 5000),
    CONSTRAINT "movies_language_valid" CHECK (length("language") > 0 AND "language" = lower(btrim("language")))
);

CREATE TABLE "cities" (
    "id" UUID NOT NULL,
    "name" CITEXT NOT NULL,
    "state" CITEXT NOT NULL,
    "country_code" CHAR(2) NOT NULL DEFAULT 'IN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "cities_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cities_name_valid" CHECK (length(btrim("name"::text)) BETWEEN 1 AND 100),
    CONSTRAINT "cities_state_valid" CHECK (length(btrim("state"::text)) BETWEEN 1 AND 100),
    CONSTRAINT "cities_country_valid" CHECK ("country_code" ~ '^[A-Z]{2}$')
);

CREATE TABLE "theatres" (
    "id" UUID NOT NULL,
    "name" CITEXT NOT NULL,
    "address" VARCHAR(500) NOT NULL,
    "city_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "theatres_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "theatres_name_valid" CHECK (length(btrim("name"::text)) BETWEEN 1 AND 100),
    CONSTRAINT "theatres_address_valid" CHECK (length(btrim("address")) > 0)
);

CREATE TABLE "screens" (
    "id" UUID NOT NULL,
    "name" CITEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "theatre_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "screens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "screens_name_valid" CHECK (length(btrim("name"::text)) BETWEEN 1 AND 100),
    CONSTRAINT "screens_capacity_valid" CHECK ("capacity" BETWEEN 1 AND 1000)
);

CREATE INDEX "movies_is_active_title_id_idx" ON "movies"("is_active", "title", "id");
CREATE INDEX "movies_is_active_language_idx" ON "movies"("is_active", "language");
CREATE INDEX "movies_genres_idx" ON "movies" USING GIN ("genres");
CREATE INDEX "cities_name_id_idx" ON "cities"("name", "id");
CREATE UNIQUE INDEX "cities_country_code_state_name_key" ON "cities"("country_code", "state", "name");
CREATE INDEX "theatres_name_id_idx" ON "theatres"("name", "id");
CREATE UNIQUE INDEX "theatres_city_id_name_key" ON "theatres"("city_id", "name");
CREATE UNIQUE INDEX "screens_theatre_id_name_key" ON "screens"("theatre_id", "name");
ALTER TABLE "theatres" ADD CONSTRAINT "theatres_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "screens" ADD CONSTRAINT "screens_theatre_id_fkey" FOREIGN KEY ("theatre_id") REFERENCES "theatres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
