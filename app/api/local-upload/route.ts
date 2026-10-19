import { NextResponse } from "next/server";
import { storage } from "@/lib/storage";
import { acceptLocalUpload, UploadRejectedError } from "@/lib/storage/local";

// Receiving end of the signed upload URLs issued by the local storage adapter. It
// stands in for Supabase Storage: it only writes bytes to disk and does no processing.
// It answers 404 whenever another storage adapter is active.
export async function PUT(request: Request) {
  if (storage.kind !== "local") return NextResponse.json({ error: "Not found" }, { status: 404 });

  const params = new URL(request.url).searchParams;
  try {
    const storagePath = await acceptLocalUpload(params, await request.arrayBuffer());
    return NextResponse.json({ storagePath });
  } catch (error) {
    if (error instanceof UploadRejectedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
