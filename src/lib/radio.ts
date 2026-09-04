/**
 * Police radio config, read on the server and passed to the client tile.
 *
 * Free tier: embed Broadcastify's own web player per feed (their ToS forbids
 * hotlinking raw stream URLs without a premium/API account).
 *   BROADCASTIFY_FEEDS="Tacoma PD South|15521,Tacoma PD North|<id>"
 *   Directory for Pierce County: https://www.broadcastify.com/listen/ctid/2984
 *
 * Premium: set BROADCASTIFY_STREAM_URL to the direct authenticated stream and
 * the tile renders a native <audio> player instead of the embed.
 */
export type RadioFeed = { label: string; id: string };
export type RadioConfig = { feeds: RadioFeed[]; directStreamUrl: string | null; directoryUrl: string };

export const DEFAULT_RADIO_FEEDS: RadioFeed[] = [{ label: "Tacoma PD South", id: "15521" }];
export const RADIO_DIRECTORY_URL = "https://www.broadcastify.com/listen/ctid/2984";

export function radioConfig(): RadioConfig {
  const raw = process.env.BROADCASTIFY_FEEDS?.trim();
  const feeds: RadioFeed[] = [];
  if (raw) {
    for (const entry of raw.split(",")) {
      const part = entry.trim();
      if (!part) continue;
      const bar = part.indexOf("|");
      const label = bar > 0 ? part.slice(0, bar).trim() : `Feed ${part}`;
      const id = (bar > 0 ? part.slice(bar + 1) : part).trim();
      if (/^\d{1,8}$/.test(id)) feeds.push({ label, id });
    }
  }
  const direct = process.env.BROADCASTIFY_STREAM_URL?.trim();
  return {
    feeds: feeds.length ? feeds : DEFAULT_RADIO_FEEDS,
    directStreamUrl: direct && /^https?:\/\//.test(direct) ? direct : null,
    directoryUrl: RADIO_DIRECTORY_URL,
  };
}
