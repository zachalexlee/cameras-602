/**
 * Server-only client for Google's Smart Device Management (SDM) API.
 *
 * Secrets (client id/secret, refresh token) never leave this module. The
 * browser only ever receives SDP answers and camera names/ids.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SDM_BASE = "https://smartdevicemanagement.googleapis.com/v1";
const LIVE_STREAM_TRAIT = "sdm.devices.traits.CameraLiveStream";
const INFO_TRAIT = "sdm.devices.traits.Info";

export class SdmError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly googleStatus?: string,
  ) {
    super(message);
    this.name = "SdmError";
  }
}

export type Camera = {
  id: string;
  name: string;
  room: string | null;
  type: "CAMERA" | "DOORBELL" | "DISPLAY" | "OTHER";
  protocols: string[];
  webrtc: boolean;
};

export type WebRtcStream = { answerSdp: string; mediaSessionId: string; expiresAt: string };
export type WebRtcExtension = { mediaSessionId: string; expiresAt: string };

function env(name: "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "GOOGLE_REFRESH_TOKEN" | "SDM_PROJECT_ID"): string {
  const v = process.env[name]?.trim();
  if (!v) throw new SdmError(`Server is missing ${name}. See docs/google-setup.md.`, 500, "NOT_CONFIGURED");
  return v;
}

export function googleConfigured(): boolean {
  return ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "SDM_PROJECT_ID"].every(
    (k) => Boolean(process.env[k]?.trim()),
  );
}

// ---- Access token cache (per serverless instance) -------------------------

let cachedToken: { value: string; expiresAt: number } | null = null;
let inflight: Promise<string> | null = null;

export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - 60_000 > now) return cachedToken.value;
  if (inflight) return inflight;

  inflight = (async () => {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env("GOOGLE_CLIENT_ID"),
        client_secret: env("GOOGLE_CLIENT_SECRET"),
        refresh_token: env("GOOGLE_REFRESH_TOKEN"),
        grant_type: "refresh_token",
      }),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !json.access_token) {
      const detail = json.error_description || json.error || `HTTP ${res.status}`;
      throw new SdmError(`Google token refresh failed: ${detail}`, 502, json.error?.toUpperCase());
    }
    cachedToken = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
    return json.access_token;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

// ---- Low-level SDM fetch ----------------------------------------------------

type GoogleErrorBody = { error?: { code?: number; message?: string; status?: string } };

async function sdmFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken();
  const projectId = env("SDM_PROJECT_ID");
  const res = await fetch(`${SDM_BASE}/enterprises/${encodeURIComponent(projectId)}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
    signal: init?.signal ?? AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as T & GoogleErrorBody;
  if (!res.ok) {
    const message = body.error?.message || `SDM request failed (${res.status})`;
    throw new SdmError(message, res.status, body.error?.status);
  }
  return body;
}

// ---- Devices ---------------------------------------------------------------

type SdmDevice = {
  name: string;
  type: string;
  traits?: Record<string, { customName?: string; supportedProtocols?: string[] }>;
  parentRelations?: Array<{ parent?: string; displayName?: string }>;
};

let cachedCameras: { value: Camera[]; expiresAt: number } | null = null;
const CAMERA_LIST_TTL_MS = 5 * 60 * 1000;

export async function listCameras(force = false): Promise<Camera[]> {
  if (!force && cachedCameras && cachedCameras.expiresAt > Date.now()) return cachedCameras.value;

  const json = await sdmFetch<{ devices?: SdmDevice[] }>("/devices");
  const cameras: Camera[] = (json.devices ?? [])
    .filter((d) => d.traits && LIVE_STREAM_TRAIT in d.traits)
    .map((d) => {
      const id = d.name.split("/").pop() ?? d.name;
      const protocols = d.traits?.[LIVE_STREAM_TRAIT]?.supportedProtocols ?? [];
      const rawType = d.type.split(".").pop() ?? "";
      const type: Camera["type"] =
        rawType === "CAMERA" || rawType === "DOORBELL" || rawType === "DISPLAY" ? rawType : "OTHER";
      const room = d.parentRelations?.find((p) => p.displayName)?.displayName ?? null;
      const custom = d.traits?.[INFO_TRAIT]?.customName?.trim();
      const name = custom || room || `${type.charAt(0)}${type.slice(1).toLowerCase()}`;
      return { id, name, room, type, protocols, webrtc: protocols.includes("WEB_RTC") };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  cachedCameras = { value: cameras, expiresAt: Date.now() + CAMERA_LIST_TTL_MS };
  return cameras;
}

// ---- WebRTC stream commands -----------------------------------------------

function executeCommand<T>(deviceId: string, command: string, params: Record<string, unknown>): Promise<{ results?: T }> {
  return sdmFetch<{ results?: T }>(`/devices/${encodeURIComponent(deviceId)}:executeCommand`, {
    method: "POST",
    body: JSON.stringify({ command, params }),
  });
}

export async function generateWebRtcStream(deviceId: string, offerSdp: string): Promise<WebRtcStream> {
  // SDM is picky about the trailing line terminator on the offer.
  const sdp = offerSdp.endsWith("\r\n") ? offerSdp : offerSdp.replace(/\r?\n?$/, "") + "\r\n";
  const json = await executeCommand<WebRtcStream>(
    deviceId,
    "sdm.devices.commands.CameraLiveStream.GenerateWebRtcStream",
    { offerSdp: sdp },
  );
  const r = json.results;
  if (!r?.answerSdp || !r.mediaSessionId || !r.expiresAt) {
    throw new SdmError("SDM returned an incomplete WebRTC answer.", 502, "BAD_RESPONSE");
  }
  return { answerSdp: r.answerSdp, mediaSessionId: r.mediaSessionId, expiresAt: r.expiresAt };
}

export async function extendWebRtcStream(deviceId: string, mediaSessionId: string): Promise<WebRtcExtension> {
  const json = await executeCommand<WebRtcExtension>(
    deviceId,
    "sdm.devices.commands.CameraLiveStream.ExtendWebRtcStream",
    { mediaSessionId },
  );
  const r = json.results;
  if (!r?.expiresAt) throw new SdmError("SDM returned an incomplete extension.", 502, "BAD_RESPONSE");
  return { mediaSessionId: r.mediaSessionId ?? mediaSessionId, expiresAt: r.expiresAt };
}

export async function stopWebRtcStream(deviceId: string, mediaSessionId: string): Promise<void> {
  await executeCommand(deviceId, "sdm.devices.commands.CameraLiveStream.StopWebRtcStream", { mediaSessionId });
}

/** Turn an SDM failure into a JSON body + HTTP status suitable for the browser. */
export function toClientError(err: unknown): { status: number; body: { error: string; code: string } } {
  if (err instanceof SdmError) {
    const code = err.googleStatus ?? (err.status === 429 ? "RESOURCE_EXHAUSTED" : "SDM_ERROR");
    let message = err.message;
    if (code === "RESOURCE_EXHAUSTED") message = "Google rate limit hit. Retrying shortly.";
    else if (code === "FAILED_PRECONDITION" || /offline/i.test(message)) message = "Camera is offline or asleep.";
    else if (code === "UNAUTHENTICATED" || code === "PERMISSION_DENIED" || code === "INVALID_GRANT") {
      message = "Google rejected the stored credentials. Re-run /api/google/connect.";
    }
    const status = err.status >= 400 && err.status < 600 ? err.status : 502;
    return { status, body: { error: message, code } };
  }
  if (err instanceof Error && err.name === "TimeoutError") {
    return { status: 504, body: { error: "Google did not respond in time.", code: "TIMEOUT" } };
  }
  return { status: 500, body: { error: "Unexpected server error.", code: "INTERNAL" } };
}
