import { NextResponse, type NextRequest } from "next/server";
import { extendWebRtcStream, generateWebRtcStream, stopWebRtcStream, toClientError } from "@/lib/google";

const DEVICE_ID_RE = /^[A-Za-z0-9_-]{1,200}$/;
const MAX_SDP_LENGTH = 64 * 1024;

type Body = { offerSdp?: unknown; extend?: unknown; stop?: unknown };

/**
 * POST { offerSdp }              -> { answerSdp, mediaSessionId, expiresAt }
 * POST { extend: mediaSessionId } -> { mediaSessionId, expiresAt }
 * POST { stop: mediaSessionId }   -> { ok: true }
 */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/cameras/[id]/stream">) {
  const { id } = await ctx.params;
  if (!DEVICE_ID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid camera id.", code: "BAD_REQUEST" }, { status: 400 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Body must be JSON.", code: "BAD_REQUEST" }, { status: 400 });
  }

  try {
    if (typeof body.offerSdp === "string") {
      if (body.offerSdp.length === 0 || body.offerSdp.length > MAX_SDP_LENGTH) {
        return NextResponse.json({ error: "offerSdp is empty or too large.", code: "BAD_REQUEST" }, { status: 400 });
      }
      return NextResponse.json(await generateWebRtcStream(id, body.offerSdp));
    }
    if (typeof body.extend === "string" && body.extend) {
      return NextResponse.json(await extendWebRtcStream(id, body.extend));
    }
    if (typeof body.stop === "string" && body.stop) {
      await stopWebRtcStream(id, body.stop);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json(
      { error: "Send { offerSdp } , { extend } or { stop }.", code: "BAD_REQUEST" },
      { status: 400 },
    );
  } catch (err) {
    const { status, body: errBody } = toClientError(err);
    return NextResponse.json(errBody, { status });
  }
}
