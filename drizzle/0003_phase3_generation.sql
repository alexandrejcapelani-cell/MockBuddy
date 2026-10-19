CREATE TYPE "public"."batch_kind" AS ENUM('initial', 'topup');--> statement-breakpoint
CREATE TYPE "public"."batch_stage" AS ENUM('draft', 'draft_retry', 'critique', 'revise', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "generation_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exam_id" uuid NOT NULL,
	"batch_index" integer NOT NULL,
	"kind" "batch_kind" NOT NULL,
	"slot_ordinals" jsonb NOT NULL,
	"stage" "batch_stage" DEFAULT 'draft' NOT NULL,
	"attempts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"drafts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verdicts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outcomes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metrics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"running_since" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generation_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "parent_exam_id" uuid;--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "plan" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_batches" ADD CONSTRAINT "generation_batches_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "generation_batches_exam_batch_idx" ON "generation_batches" USING btree ("exam_id","batch_index");--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_parent_exam_id_exams_id_fk" FOREIGN KEY ("parent_exam_id") REFERENCES "public"."exams"("id") ON DELETE set null ON UPDATE no action;