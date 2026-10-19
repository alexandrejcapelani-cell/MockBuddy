CREATE TYPE "public"."batch_kind" AS ENUM('initial', 'topup');--> statement-breakpoint
CREATE TYPE "public"."batch_stage" AS ENUM('draft', 'draft_retry', 'critique', 'revise', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."exam_difficulty" AS ENUM('easier', 'same', 'harder');--> statement-breakpoint
CREATE TYPE "public"."exam_status" AS ENUM('generating', 'ready', 'graded');--> statement-breakpoint
CREATE TYPE "public"."material_status" AS ENUM('uploaded', 'extracting', 'chunked', 'failed');--> statement-breakpoint
CREATE TYPE "public"."question_difficulty" AS ENUM('easy', 'medium', 'hard');--> statement-breakpoint
CREATE TYPE "public"."question_type" AS ENUM('mcq', 'short', 'numerical');--> statement-breakpoint
CREATE TABLE "answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exam_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"response" text NOT NULL,
	"is_correct" boolean NOT NULL,
	"awarded_marks" double precision NOT NULL,
	"feedback" text,
	"rubric_marks" jsonb,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "answers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "blueprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"source_filename" text NOT NULL,
	"storage_path" text NOT NULL,
	"spec" jsonb NOT NULL,
	"sample_questions" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blueprints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"material_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"section_label" text NOT NULL,
	"topic_label" text,
	"content" text NOT NULL,
	"token_estimate" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chunks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "exams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"blueprint_id" uuid NOT NULL,
	"parent_exam_id" uuid,
	"question_count" integer NOT NULL,
	"difficulty" "exam_difficulty" NOT NULL,
	"status" "exam_status" DEFAULT 'generating' NOT NULL,
	"used_chunk_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generation_seed" integer NOT NULL,
	"plan" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exams" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
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
CREATE TABLE "materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"storage_path" text NOT NULL,
	"page_count" integer,
	"status" "material_status" DEFAULT 'uploaded' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "materials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exam_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"type" "question_type" NOT NULL,
	"prompt" text NOT NULL,
	"marks" double precision NOT NULL,
	"options" jsonb,
	"correct_option" integer,
	"option_explanations" jsonb,
	"correct_explanation" text NOT NULL,
	"expected_answer" text,
	"rubric" jsonb,
	"numeric_answer" double precision,
	"tolerance" double precision,
	"unit" text,
	"worked_solution" text NOT NULL,
	"source_chunk_id" uuid NOT NULL,
	"source_excerpt" text NOT NULL,
	"topic_label" text NOT NULL,
	"difficulty" "question_difficulty" NOT NULL
);
--> statement-breakpoint
ALTER TABLE "questions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subjects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blueprints" ADD CONSTRAINT "blueprints_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blueprints" ADD CONSTRAINT "blueprints_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_blueprint_id_blueprints_id_fk" FOREIGN KEY ("blueprint_id") REFERENCES "public"."blueprints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_parent_exam_id_exams_id_fk" FOREIGN KEY ("parent_exam_id") REFERENCES "public"."exams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_batches" ADD CONSTRAINT "generation_batches_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_source_chunk_id_chunks_id_fk" FOREIGN KEY ("source_chunk_id") REFERENCES "public"."chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "answers_question_id_idx" ON "answers" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "answers_exam_id_idx" ON "answers" USING btree ("exam_id");--> statement-breakpoint
CREATE INDEX "blueprints_subject_created_idx" ON "blueprints" USING btree ("subject_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "chunks_material_ordinal_idx" ON "chunks" USING btree ("material_id","ordinal");--> statement-breakpoint
CREATE INDEX "exams_user_created_idx" ON "exams" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "exams_subject_id_idx" ON "exams" USING btree ("subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_batches_exam_batch_idx" ON "generation_batches" USING btree ("exam_id","batch_index");--> statement-breakpoint
CREATE INDEX "materials_subject_id_idx" ON "materials" USING btree ("subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "questions_exam_ordinal_idx" ON "questions" USING btree ("exam_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "subjects_user_name_idx" ON "subjects" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE POLICY "answers_select_own" ON "answers" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from public.exams p where p.id = exam_id and p.user_id = (select auth.uid())));--> statement-breakpoint
CREATE POLICY "blueprints_select_own" ON "blueprints" AS PERMISSIVE FOR SELECT TO "authenticated" USING (user_id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "chunks_select_own" ON "chunks" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from public.materials p where p.id = material_id and p.user_id = (select auth.uid())));--> statement-breakpoint
CREATE POLICY "exams_select_own" ON "exams" AS PERMISSIVE FOR SELECT TO "authenticated" USING (user_id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "generation_batches_select_own" ON "generation_batches" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from public.exams p where p.id = exam_id and p.user_id = (select auth.uid())));--> statement-breakpoint
CREATE POLICY "materials_select_own" ON "materials" AS PERMISSIVE FOR SELECT TO "authenticated" USING (user_id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "questions_select_own" ON "questions" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from public.exams p where p.id = exam_id and p.user_id = (select auth.uid())));--> statement-breakpoint
CREATE POLICY "subjects_select_own" ON "subjects" AS PERMISSIVE FOR SELECT TO "authenticated" USING (user_id = (select auth.uid()));