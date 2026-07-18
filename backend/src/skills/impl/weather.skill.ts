import { Injectable, Logger } from '@nestjs/common';
import { Skill, SkillResult } from '../skill.interface';

const WEATHER_CODES: Record<number, string> = {
  0: 'clear sky',
  1: 'mostly clear',
  2: 'partly cloudy',
  3: 'overcast',
  45: 'fog',
  48: 'depositing rime fog',
  51: 'light drizzle',
  53: 'drizzle',
  55: 'dense drizzle',
  61: 'light rain',
  63: 'rain',
  65: 'heavy rain',
  66: 'freezing rain',
  67: 'heavy freezing rain',
  71: 'light snow',
  73: 'snow',
  75: 'heavy snow',
  77: 'snow grains',
  80: 'light showers',
  81: 'showers',
  82: 'violent showers',
  85: 'snow showers',
  86: 'heavy snow showers',
  95: 'thunderstorm',
  96: 'thunderstorm with hail',
  99: 'thunderstorm with heavy hail',
};

interface GeocodeResult {
  results?: {
    name: string;
    country?: string;
    latitude: number;
    longitude: number;
    timezone?: string;
  }[];
}

interface ForecastResult {
  current?: {
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    wind_speed_10m: number;
    weather_code: number;
  };
  daily?: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: (number | null)[];
  };
}

@Injectable()
export class WeatherSkill implements Skill {
  private readonly logger = new Logger(WeatherSkill.name);

  readonly name = 'get_weather';
  readonly description =
    'Get current weather and a short forecast for a city or place (via Open-Meteo, no key needed).';
  readonly requiresConfirmation = false;
  readonly parameters = {
    type: 'object',
    properties: {
      location: { type: 'string', description: 'City or place name, e.g. "Tunis" or "Paris, France"' },
      days: { type: 'number', description: 'Forecast days to include (0-7). Default 3.' },
    },
    required: ['location'],
  };

  async execute(args: Record<string, unknown>): Promise<SkillResult> {
    const location = String(args?.location ?? '').trim();
    if (!location) {
      return { success: false, output: 'Missing "location" argument.' };
    }
    const days = Math.min(Math.max(Number(args?.days ?? 3) || 0, 0), 7);

    try {
      const geoResponse = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`,
      );
      if (!geoResponse.ok) {
        return { success: false, output: `Geocoding failed with status ${geoResponse.status}.` };
      }
      const geo = (await geoResponse.json()) as GeocodeResult;
      const place = geo.results?.[0];
      if (!place) {
        return { success: false, output: `I couldn't find a place called "${location}".` };
      }

      const forecastUrl =
        `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
        '&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code' +
        '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
        `&forecast_days=${Math.max(days, 1)}&timezone=auto`;
      const forecastResponse = await fetch(forecastUrl);
      if (!forecastResponse.ok) {
        return { success: false, output: `Weather lookup failed with status ${forecastResponse.status}.` };
      }
      const data = (await forecastResponse.json()) as ForecastResult;

      const lines: string[] = [];
      const label = `${place.name}${place.country ? `, ${place.country}` : ''}`;
      if (data.current) {
        const c = data.current;
        lines.push(
          `Now in ${label}: ${describe(c.weather_code)}, ${Math.round(c.temperature_2m)}°C ` +
            `(feels like ${Math.round(c.apparent_temperature)}°C), humidity ${c.relative_humidity_2m}%, ` +
            `wind ${Math.round(c.wind_speed_10m)} km/h.`,
        );
      }
      if (days > 0 && data.daily) {
        for (let i = 0; i < Math.min(days, data.daily.time.length); i++) {
          const pop = data.daily.precipitation_probability_max[i];
          lines.push(
            `${data.daily.time[i]}: ${describe(data.daily.weather_code[i])}, ` +
              `${Math.round(data.daily.temperature_2m_min[i])}°C to ${Math.round(data.daily.temperature_2m_max[i])}°C` +
              (pop != null ? `, ${pop}% chance of precipitation` : ''),
          );
        }
      }
      return { success: true, output: lines.join('\n') };
    } catch (error) {
      this.logger.warn(`get_weather failed: ${(error as Error).message}`);
      return { success: false, output: `Weather service error: ${(error as Error).message}` };
    }
  }
}

function describe(code: number): string {
  return WEATHER_CODES[code] ?? `weather code ${code}`;
}
