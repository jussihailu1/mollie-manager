CREATE TYPE "public"."customer_note_source" AS ENUM('operator', 'legacy_customer_notes');--> statement-breakpoint
CREATE TABLE "customer_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"mode" "mollie_mode" NOT NULL,
	"customer_id" text NOT NULL,
	"body" text NOT NULL,
	"source" "customer_note_source" DEFAULT 'operator' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "customer_notes_body_not_blank_check" CHECK (length(btrim("customer_notes"."body")) > 0)
);
--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_notes_customer_created_idx" ON "customer_notes" USING btree ("customer_id","created_at" DESC);--> statement-breakpoint
INSERT INTO "customer_notes" (
	"id",
	"mode",
	"customer_id",
	"body",
	"source",
	"created_at",
	"updated_at"
)
SELECT
	concat('legacy-customer-note:', c.id),
	c.mode,
	c.id,
	btrim(c.notes),
	'legacy_customer_notes',
	coalesce(c.created_at, now()),
	now()
FROM "customers" c
WHERE nullif(btrim(c.notes), '') IS NOT NULL
ON CONFLICT ("id") DO NOTHING;
