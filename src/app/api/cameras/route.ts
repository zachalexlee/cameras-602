import { NextResponse } from "next/server";
import { googleConfigured, listCameras, toClientError } from "@/lib/google";

export async function GET(req: Request) {
  if (!googleConfigured()) {
    return NextResponse.json(
      { error: "Google is not linked yet. Finish docs/google-setup.md, then redeploy.", code: "NOT_CONFIGURED" },
      { status: 503 },
    );
  }
  const force = new URL(req.url).searchParams.get("refresh") === "1";
  try {
    const cameras = await listCameras(force);
    return NextResponse.json({ cameras }, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (err) {
    const { status, body } = toClientError(err);
    return NextResponse.json(body, { status });
  }
}
