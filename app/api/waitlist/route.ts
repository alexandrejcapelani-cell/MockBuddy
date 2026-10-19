import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { waitlist } from "@/lib/db/schema";
import { errorResponse, parseBody, RequestError } from "@/lib/http";

const Body = z.object({ email: z.string().max(254) });
const Email = z.email();

/**
 * Adds an email address to the waitlist. The reply is the same whether or not the address
 * was already there, so the form can't be used to find out who has signed up. Addresses
 * are never logged.
 */
export async function POST(request: Request) {
  try {
    const { email } = await parseBody(request, Body);
    const normalized = email.trim().toLowerCase();
    if (!Email.safeParse(normalized).success) throw new RequestError("That doesn't look like an email address.");
    await db().insert(waitlist).values({ email: normalized }).onConflictDoNothing({ target: waitlist.email });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
