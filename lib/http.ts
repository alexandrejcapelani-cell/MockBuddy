import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ModelCallError } from "@/lib/ai/call";
import { ConfigError } from "@/lib/env";
import { DocumentError } from "@/lib/ingest/extract";
import { IngestError } from "@/lib/ingest/ingest";
import { StorageNotFoundError } from "@/lib/storage";

// Shared request parsing and error responses for the API routes. Known failures become
// a JSON { error } body with a fitting status; anything unexpected is rethrown so Next.js
// logs it and answers 500.

export class RequestError extends Error {
  override name = "RequestError";
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 413 | 415 | 422 = 400,
  ) {
    super(message);
  }
}

export async function parseBody<S extends z.ZodType>(request: Request, schema: S): Promise<z.output<S>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) throw new RequestError("The request body must be JSON.");
    throw error;
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new RequestError(`Invalid request: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  }
  return parsed.data;
}

/** The `[examId]` route segment, rejecting anything that isn't an exam id. */
export async function examIdParam(params: Promise<{ examId: string }>): Promise<string> {
  const { examId } = await params;
  if (!z.uuid().safeParse(examId).success) throw new RequestError("That exam doesn't exist.", 404);
  return examId;
}

export function errorResponse(error: unknown, extra: Record<string, unknown> = {}): NextResponse {
  if (error instanceof RequestError || error instanceof IngestError) {
    return NextResponse.json({ error: error.message, ...extra }, { status: error.status });
  }
  if (error instanceof DocumentError) return NextResponse.json({ error: error.message, ...extra }, { status: 422 });
  if (error instanceof StorageNotFoundError) return NextResponse.json({ error: error.message, ...extra }, { status: 404 });
  if (error instanceof ConfigError) return NextResponse.json({ error: error.message, ...extra }, { status: 500 });
  if (error instanceof ModelCallError) {
    const status = error.retryable ? 503 : error.kind === "config" ? 500 : 502;
    return NextResponse.json(
      {
        error: error.message,
        kind: error.kind,
        retryable: error.retryable,
        retryAfterMs: error.details.retryAfterMs ?? null,
        calls: [error.metrics],
        ...extra,
      },
      { status },
    );
  }
  throw error;
}
