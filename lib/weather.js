// Today's weather for the home city, from Open-Meteo. Free, no API key, no
// account, CORS-enabled - so it's called straight from the browser and
// nothing new has to go in Vercel. Two endpoints: geocoding (city name ->
// coordinates, done once when the city is saved on the Profile tab) and the
// forecast (done each time Style me opens). The only thing that leaves the
// browser is the city's coordinates.
//
// Kept free of React so it can be unit-tested in plain node.

const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

// Resolve a typed city name to coordinates. Returns null when nothing
// matches (a typo, or somewhere Open-Meteo doesn't know).
export async function geocodeCity(name) {
  const q = (name || "").trim();
  if (!q) return null;
  const url = `${GEOCODE_URL}?name=${encodeURIComponent(q)}&count=1&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding failed (${res.status})`);
  const j = await res.json();
  const r = j.results?.[0];
  if (!r) return null;
  return {
    // "Melbourne, Victoria, Australia" - enough to confirm it picked the
    // right one of several same-named places.
    label: [r.name, r.admin1, r.country].filter(Boolean).join(", "),
    city: r.name,
    lat: r.latitude,
    lon: r.longitude,
    tz: r.timezone || "auto",
  };
}

// WMO weather codes -> a short phrase. Open-Meteo returns the code; the
// phrasing is ours, kept plain so it reads naturally in "Today in X: ...".
const WMO = [
  [[0], "clear"],
  [[1], "mostly clear"],
  [[2], "partly cloudy"],
  [[3], "overcast"],
  [[45, 48], "foggy"],
  [[51, 53, 55], "light drizzle"],
  [[56, 57], "freezing drizzle"],
  [[61], "light rain"],
  [[63], "rain"],
  [[65], "heavy rain"],
  [[66, 67], "freezing rain"],
  [[71, 73], "snow"],
  [[75, 77], "heavy snow"],
  [[80], "light showers"],
  [[81], "showers"],
  [[82], "heavy showers"],
  [[85, 86], "snow showers"],
  [[95], "thunderstorms"],
  [[96, 99], "thunderstorms with hail"],
];

export function describeCode(code) {
  const hit = WMO.find(([codes]) => codes.includes(code));
  return hit ? hit[1] : "";
}

// Today's conditions. Uses the day's high for the season call rather than
// the temperature right now, because "now" at 7am says cold on a day that
// hits 26.
export async function fetchToday({ lat, lon, tz }) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m",
    daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code",
    timezone: tz || "auto",
    forecast_days: "1",
  });
  const res = await fetch(`${FORECAST_URL}?${params}`);
  if (!res.ok) throw new Error(`Weather failed (${res.status})`);
  const j = await res.json();
  const c = j.current || {};
  const d = j.daily || {};
  const code = c.weather_code ?? d.weather_code?.[0];
  return {
    tempC: Math.round(c.temperature_2m),
    feelsC: Math.round(c.apparent_temperature),
    highC: Math.round(d.temperature_2m_max?.[0]),
    lowC: Math.round(d.temperature_2m_min?.[0]),
    rainProb: d.precipitation_probability_max?.[0] ?? null,
    windKmh: Math.round(c.wind_speed_10m),
    code,
    description: describeCode(code),
    // Rain worth dressing for: it's raining now, or likely to today.
    wet: [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code) ||
      (d.precipitation_probability_max?.[0] ?? 0) >= 60,
  };
}

// Map today onto the app's season filter. The in-between band deliberately
// returns "" (Any season): 18 to 23 is layering weather, and forcing either
// end would hide half the wardrobe on exactly the days it's hardest to
// choose. Thresholds are on the day's high, see fetchToday.
export function seasonFromWeather(w) {
  if (!w || typeof w.highC !== "number" || Number.isNaN(w.highC)) return "";
  if (w.highC <= 17) return "Cold weather";
  if (w.highC >= 24) return "Warm weather";
  return "";
}

// "Today in Melbourne: 12°C (feels 10°), light drizzle, high 17°, 96%
// chance of rain". Omits parts that aren't available or aren't
// interesting (feels-like within a degree of actual, rain chance under 30%).
export function summarise(city, w) {
  if (!w) return "";
  const parts = [];
  let temp = `${w.tempC}°C`;
  if (Math.abs(w.feelsC - w.tempC) >= 2) temp += ` (feels ${w.feelsC}°)`;
  parts.push(temp);
  if (w.description) parts.push(w.description);
  if (typeof w.highC === "number" && !Number.isNaN(w.highC)) parts.push(`high ${w.highC}°`);
  if (typeof w.rainProb === "number" && w.rainProb >= 30) parts.push(`${w.rainProb}% chance of rain`);
  return `Today in ${city}: ${parts.join(", ")}`;
}
