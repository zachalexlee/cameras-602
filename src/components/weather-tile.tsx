"use client";

import { useEffect, useState } from "react";
import { Panel } from "@/components/panel";

/** Tacoma, WA. api.weather.gov is open-CORS and needs no key from the browser. */
const LAT = 47.2529;
const LON = -122.4443;
const REFRESH_MS = 15 * 60 * 1000;
const NWS = "https://api.weather.gov";
const HEADERS = { Accept: "application/geo+json" };

type Period = {
  name: string;
  temperature: number;
  temperatureUnit: string;
  shortForecast: string;
  isDaytime: boolean;
  windSpeed?: string;
  windDirection?: string;
  probabilityOfPrecipitation?: { value: number | null };
};

type Weather = {
  place: string;
  now: { tempF: number | null; text: string; windMph: number | null; windDir: string | null; humidity: number | null; asOf: string | null };
  periods: Period[];
  fetchedAt: number;
};

let endpoints: { forecast: string; hourly: string; stations: string; place: string } | null = null;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: HEADERS, cache: "no-store" });
  if (!res.ok) throw new Error(`${new URL(url).pathname} → ${res.status}`);
  return (await res.json()) as T;
}

function cToF(c: number | null | undefined): number | null {
  return typeof c === "number" ? Math.round((c * 9) / 5 + 32) : null;
}
function kmhToMph(k: number | null | undefined): number | null {
  return typeof k === "number" ? Math.round(k / 1.609) : null;
}
function degToCompass(d: number | null | undefined): string | null {
  if (typeof d !== "number") return null;
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(d / 45) % 8];
}

async function loadWeather(): Promise<Weather> {
  if (!endpoints) {
    const pts = await getJson<{
      properties: { forecast: string; forecastHourly: string; observationStations: string; relativeLocation?: { properties?: { city?: string; state?: string } } };
    }>(`${NWS}/points/${LAT},${LON}`);
    const rl = pts.properties.relativeLocation?.properties;
    endpoints = {
      forecast: pts.properties.forecast,
      hourly: pts.properties.forecastHourly,
      stations: pts.properties.observationStations,
      place: rl?.city ? `${rl.city}, ${rl.state ?? "WA"}` : "Tacoma, WA",
    };
  }

  const [forecast, hourly, obs] = await Promise.all([
    getJson<{ properties: { periods: Period[] } }>(endpoints.forecast),
    getJson<{ properties: { periods: Period[] } }>(endpoints.hourly).catch(() => null),
    (async () => {
      const st = await getJson<{ features: Array<{ properties: { stationIdentifier: string } }> }>(endpoints!.stations);
      const id = st.features[0]?.properties.stationIdentifier;
      if (!id) return null;
      return getJson<{
        properties: {
          timestamp: string;
          textDescription: string;
          temperature: { value: number | null };
          windSpeed: { value: number | null };
          windDirection: { value: number | null };
          relativeHumidity: { value: number | null };
        };
      }>(`${NWS}/stations/${id}/observations/latest`);
    })().catch(() => null),
  ]);

  const p = obs?.properties;
  const hourNow = hourly?.properties.periods[0];
  const tempF = cToF(p?.temperature.value) ?? hourNow?.temperature ?? null;
  const text = p?.textDescription?.trim() || hourNow?.shortForecast || forecast.properties.periods[0]?.shortForecast || "—";

  return {
    place: endpoints.place,
    now: {
      tempF,
      text,
      windMph: kmhToMph(p?.windSpeed.value),
      windDir: degToCompass(p?.windDirection.value),
      humidity: typeof p?.relativeHumidity.value === "number" ? Math.round(p.relativeHumidity.value) : null,
      asOf: p?.timestamp ?? null,
    },
    periods: forecast.properties.periods.slice(0, 5),
    fetchedAt: Date.now(),
  };
}

export function WeatherTile() {
  const [data, setData] = useState<Weather | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const w = await loadWeather();
        if (cancelled) return;
        setData(w);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        endpoints = null; // re-resolve next time in case the grid changed
        setError((e as Error).message || "Weather unavailable");
      }
    };
    const first = window.setTimeout(() => void run(), 0);
    const id = window.setInterval(() => void run(), REFRESH_MS);
    const onVisible = () => document.visibilityState === "visible" && void run();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(first);
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const asOf = data?.now.asOf
    ? new Date(data.now.asOf).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : null;

  return (
    <Panel
      title="Weather"
      meta={
        error && !data ? <span className="text-danger">Offline</span> : error ? <span className="text-warn">Stale</span> : <span>{data?.place ?? "NWS"}</span>
      }
      bodyClassName="px-4 py-3"
    >
      {!data ? (
        <p className="label text-muted">{error ? `NWS unreachable · ${error}` : "Contacting National Weather Service"}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="glow font-mono text-5xl font-medium tabular-nums leading-none">
                {data.now.tempF ?? "--"}
                <span className="ml-1 text-2xl text-muted">°F</span>
              </div>
              <div className="mt-2 text-sm text-foreground/90">{data.now.text}</div>
            </div>
            <dl className="label grid grid-cols-[auto_auto] gap-x-3 gap-y-1 text-right text-[10px] text-muted">
              <dt>Wind</dt>
              <dd className="text-foreground/80">
                {data.now.windMph === null ? "—" : `${data.now.windDir ?? ""} ${data.now.windMph} mph`.trim()}
              </dd>
              <dt>Humidity</dt>
              <dd className="text-foreground/80">{data.now.humidity === null ? "—" : `${data.now.humidity}%`}</dd>
              <dt>As of</dt>
              <dd className="text-foreground/80">{asOf ?? "—"}</dd>
            </dl>
          </div>

          <ul className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-line pt-3 sm:grid-cols-5 xl:grid-cols-2 2xl:grid-cols-5">
            {data.periods.map((p) => (
              <li key={p.name} className="min-w-0">
                <div className="label truncate text-[10px] text-muted">{p.name}</div>
                <div className="font-mono text-lg tabular-nums">
                  {p.temperature}°<span className="ml-1 text-[10px] text-muted">{p.isDaytime ? "HI" : "LO"}</span>
                </div>
                <div className="truncate text-xs text-foreground/80" title={p.shortForecast}>
                  {p.shortForecast}
                </div>
                {typeof p.probabilityOfPrecipitation?.value === "number" && p.probabilityOfPrecipitation.value > 0 ? (
                  <div className="label text-[10px] text-accent">{p.probabilityOfPrecipitation.value}% precip</div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
