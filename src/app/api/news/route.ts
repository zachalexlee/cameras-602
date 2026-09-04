import { NextResponse } from "next/server";
import { getNews } from "@/lib/news";

/**
 * GET /api/news            -> { items, fetchedAt, failed, sources }
 * GET /api/news?refresh=1  -> bypass the 10-minute cache
 * GET /api/news?debug=1    -> compact per-feed status only (which sources respond)
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const force = params.get("refresh") === "1";
  try {
    const payload = await getNews(force);
    if (params.get("debug") === "1") {
      return NextResponse.json(
        { fetchedAt: payload.fetchedAt, total: payload.items.length, sources: payload.sources },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(payload, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch {
    return NextResponse.json({ error: "News feeds unavailable.", items: [], failed: [], sources: [] }, { status: 502 });
  }
}
