/**
 * Server-side RSS/Atom fetch + merge for the ticker. No dependencies: a small
 * tolerant parser that handles RSS 2.0 <item> and Atom <entry>.
 *
 * Feed list comes from NEWS_FEEDS (comma-separated URLs) or the defaults below.
 * Note: AP no longer publishes an official RSS feed, so the defaults use NPR,
 * BBC and KING 5 (Seattle/Tacoma). Swap freely via NEWS_FEEDS.
 */

export type NewsItem = { title: string; link: string; source: string; publishedAt: string | null };
export type FeedSource = { label: string; url: string };
export type FeedStatus = { label: string; url: string; ok: boolean; count: number; error: string | null };

/**
 * Default sources: national + Seattle/Tacoma local. Order matters only for the
 * round-robin start. Override with NEWS_FEEDS="Label|https://url, Label|https://url"
 * (bare URLs are fine too; the label then falls back to the feed's own title).
 */
export const DEFAULT_FEEDS: FeedSource[] = [
  { label: "News Tribune", url: "https://www.thenewstribune.com/news/local/?widgetName=rssfeed&widgetContentId=712015&getXmlFeed=true" },
  { label: "Fox News", url: "https://moxie.foxnews.com/google-publisher/latest.xml" },
  { label: "KIRO 7", url: "https://www.kiro7.com/arc/outboundfeeds/rss/category/news/local/?outputType=xml" },
  { label: "BBC", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { label: "FOX 13", url: "https://www.fox13seattle.com/rss/category/local-news" },
  { label: "NPR", url: "https://feeds.npr.org/1001/rss.xml" },
  { label: "KING 5", url: "https://www.king5.com/feeds/syndication/rss/news/local" },
  { label: "MyNorthwest", url: "https://mynorthwest.com/feed/" },
  { label: "Tacoma Weekly", url: "https://tacomaweekly.com/feed/" },
  { label: "Suburban Times", url: "https://thesubtimes.com/feed/" },
];

const CACHE_TTL_MS = 10 * 60 * 1000;
const FEED_TIMEOUT_MS = 8_000;
const MAX_ITEMS = 60;
const MAX_PER_FEED = 8;

export function feedSources(): FeedSource[] {
  const raw = process.env.NEWS_FEEDS?.trim();
  if (!raw) return DEFAULT_FEEDS;
  const sources: FeedSource[] = [];
  for (const entry of raw.split(",")) {
    const part = entry.trim();
    if (!part) continue;
    const bar = part.indexOf("|");
    const label = bar > 0 ? part.slice(0, bar).trim() : "";
    const url = (bar > 0 ? part.slice(bar + 1) : part).trim();
    if (/^https?:\/\//.test(url)) sources.push({ label, url });
  }
  return sources.length ? sources : DEFAULT_FEEDS;
}

// ---- Tiny XML helpers ---------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function clean(s: string): string {
  // Unwrap CDATA, strip raw tags, decode entities, then strip tags that were entity-escaped (Atom type="html").
  const unwrapped = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "");
  return decodeEntities(unwrapped).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : null;
}

function atomLink(block: string): string | null {
  // Prefer rel="alternate" (or no rel), which is the human-readable page.
  const links = [...block.matchAll(/<link\b([^>]*)\/?>/gi)];
  for (const [, attrs] of links) {
    const rel = attrs.match(/\brel=["']([^"']+)["']/i)?.[1];
    const href = attrs.match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (href && (!rel || rel === "alternate")) return decodeEntities(href);
  }
  return null;
}

export function parseFeed(xml: string, fallbackSource: string, label = ""): NewsItem[] {
  const source = label || clean(tag(xml.slice(0, 20_000), "title") ?? "") || fallbackSource;
  const blocks = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  const items: NewsItem[] = [];
  for (const block of blocks) {
    const title = clean(tag(block, "title") ?? "");
    if (!title) continue;
    let link = clean(tag(block, "link") ?? "");
    if (!/^https?:\/\//.test(link)) link = atomLink(block) ?? "";
    if (!/^https?:\/\//.test(link)) continue;
    const dateRaw = tag(block, "pubDate") ?? tag(block, "published") ?? tag(block, "updated") ?? tag(block, "dc:date");
    const ts = dateRaw ? Date.parse(clean(dateRaw)) : NaN;
    items.push({ title, link, source, publishedAt: Number.isFinite(ts) ? new Date(ts).toISOString() : null });
    if (items.length >= MAX_PER_FEED) break;
  }
  return items;
}

// ---- Fetch + merge ------------------------------------------------------------

async function fetchFeed({ url, label }: FeedSource): Promise<NewsItem[]> {
  const res = await fetch(url, {
    headers: { "User-Agent": "HomeOpsDashboard/0.2 (+personal wall display)", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    next: { revalidate: 600 },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = parseFeed(await res.text(), new URL(url).hostname.replace(/^www\./, ""), label);
  if (!items.length) throw new Error("No items parsed (not a feed?)");
  return items;
}

function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Round-robin across feeds so one source never dominates the ticker. */
export function mergeFeeds(perFeed: NewsItem[][]): NewsItem[] {
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  const queues = perFeed.map((items) => [...items]);
  while (out.length < MAX_ITEMS && queues.some((q) => q.length)) {
    for (const q of queues) {
      const item = q.shift();
      if (!item) continue;
      const key = normalizeTitle(item.title);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
      if (out.length >= MAX_ITEMS) break;
    }
  }
  return out;
}

export type NewsPayload = { items: NewsItem[]; fetchedAt: string; failed: string[]; sources: FeedStatus[] };
let cache: { value: NewsPayload; expiresAt: number } | null = null;

export async function getNews(force = false): Promise<NewsPayload> {
  if (!force && cache && cache.expiresAt > Date.now()) return cache.value;

  const sources = feedSources();
  const settled = await Promise.allSettled(sources.map(fetchFeed));
  const perFeed: NewsItem[][] = [];
  const failed: string[] = [];
  const statuses: FeedStatus[] = settled.map((r, i) => {
    const { label, url } = sources[i];
    if (r.status === "fulfilled") {
      perFeed.push(r.value);
      return { label: label || r.value[0]?.source || url, url, ok: true, count: r.value.length, error: null };
    }
    failed.push(url);
    const reason = r.reason instanceof Error ? (r.reason.name === "TimeoutError" ? "Timed out" : r.reason.message) : String(r.reason);
    return { label: label || url, url, ok: false, count: 0, error: reason };
  });

  const payload: NewsPayload = { items: mergeFeeds(perFeed), fetchedAt: new Date().toISOString(), failed, sources: statuses };
  // Keep serving the last good list if every feed failed this round.
  if (payload.items.length === 0 && cache?.value.items.length) {
    return { ...cache.value, failed, sources: statuses };
  }
  cache = { value: payload, expiresAt: Date.now() + CACHE_TTL_MS };
  return payload;
}
