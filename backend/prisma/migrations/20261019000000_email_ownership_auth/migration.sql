-- Additive only. No legacy account is considered verified by this migration.
ALTER TABLE "users"
  ADD COLUMN "email_verified_at" TIMESTAMPTZ(3),
  ADD COLUMN "auth_disabled_at" TIMESTAMPTZ(3),
  ADD COLUMN "auth_version" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "users_auth_version_nonnegative" CHECK ("auth_version" >= 0);

CREATE TABLE "account_quarantines" (
  "id" UUID NOT NULL,
  "original_user_id" UUID NOT NULL,
  "replacement_user_id" UUID NOT NULL,
  "original_email" VARCHAR(254) NOT NULL,
  "reason" VARCHAR(50) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "account_quarantines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "account_quarantines_distinct_users" CHECK ("original_user_id" <> "replacement_user_id"),
  CONSTRAINT "account_quarantines_original_user_id_fkey" FOREIGN KEY ("original_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "account_quarantines_replacement_user_id_fkey" FOREIGN KEY ("replacement_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "account_quarantines_original_user_id_key" ON "account_quarantines"("original_user_id");
CREATE UNIQUE INDEX "account_quarantines_replacement_user_id_key" ON "account_quarantines"("replacement_user_id");
