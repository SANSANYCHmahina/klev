#!/usr/bin/env python3
"""Скачивает погоду Open-Meteo по сетке точек над Ростовской областью и кладёт её на сайт (папка wx/).

Запускается на серверах GitHub (см. .github/workflows/pages.yml): оттуда Open-Meteo доступен,
а приложение потом берёт погоду с вашего же сайта — без VPN.
"""
import json, os, sys, time, urllib.parse, urllib.request

LAT0, LAT1, LON0, LON1, STEP = 46.5, 48.0, 38.0, 42.25, 0.25
PAST, FUTURE = 10, 7
HOURLY = 'temperature_2m,relative_humidity_2m,surface_pressure,pressure_msl,precipitation,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code'
DAILY = 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,sunrise,sunset'
MODELS = 'icon_seamless,ecmwf_ifs025'
API = 'https://api.open-meteo.com/v1/forecast'
MARINE = 'https://marine-api.open-meteo.com/v1/marine'
CHUNK, PAUSE = 15, 20  # точек в запросе и пауза между запросами, чтобы не упираться в лимит Open-Meteo
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'wx')


def frange(a, b, s):
    n = int(round((b - a) / s))
    return [round(a + i * s, 2) for i in range(n + 1)]


def get(params, tries=3, base=API):
    url = base + '?' + urllib.parse.urlencode(params)
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'klev-fishing-app'}), timeout=60) as r:
                return json.loads(r.read().decode('utf-8'))
        except Exception as e:  # noqa: BLE001
            print('  ошибка:', e, file=sys.stderr)
            time.sleep(10 * (k + 1))
    return None


def main():
    os.makedirs(OUT, exist_ok=True)
    pts = [(la, lo) for la in frange(LAT0, LAT1, STEP) for lo in frange(LON0, LON1, STEP)]
    print('точек:', len(pts))
    common = {'timezone': 'auto', 'timeformat': 'unixtime', 'wind_speed_unit': 'ms', 'past_days': PAST, 'forecast_days': FUTURE}
    ok = 0
    for i in range(0, len(pts), CHUNK):
        part = pts[i:i + CHUNK]
        loc = {'latitude': ','.join(f'{p[0]:.2f}' for p in part), 'longitude': ','.join(f'{p[1]:.2f}' for p in part)}
        base = get({**loc, **common, 'hourly': HOURLY, 'daily': DAILY})
        time.sleep(PAUSE)
        models = get({**loc, **common, 'hourly': HOURLY, 'models': MODELS})
        time.sleep(PAUSE)
        if base is None:
            continue
        if isinstance(base, dict):
            base = [base]
        if isinstance(models, dict):
            models = [models]
        for k, (la, lo) in enumerate(part):
            b = base[k] if k < len(base) else None
            if not b or 'hourly' not in b:
                continue
            m = models[k] if models and k < len(models) else None
            with open(os.path.join(OUT, f'{la:.2f}_{lo:.2f}.json'), 'w', encoding='utf-8') as f:
                json.dump({'fetched': int(time.time()), 'base': b, 'models': m}, f, separators=(',', ':'))
            ok += 1
        print(f'  {min(i + CHUNK, len(pts))}/{len(pts)}')
    # Температура поверхности воды (модель моря, ближайшая морская клетка — Таганрогский залив / Азовское море)
    sst_ok = 0
    for i in range(0, len(pts), CHUNK * 2):
        part = pts[i:i + CHUNK * 2]
        loc = {'latitude': ','.join(f'{p[0]:.2f}' for p in part), 'longitude': ','.join(f'{p[1]:.2f}' for p in part)}
        mar = get({**loc, 'hourly': 'sea_surface_temperature', 'cell_selection': 'sea', 'timezone': 'auto',
                   'timeformat': 'unixtime', 'past_days': PAST, 'forecast_days': FUTURE}, base=MARINE)
        time.sleep(PAUSE)
        if mar is None:
            continue
        if isinstance(mar, dict):
            mar = [mar]
        for k, (la, lo) in enumerate(part):
            m = mar[k] if k < len(mar) else None
            fn = os.path.join(OUT, f'{la:.2f}_{lo:.2f}.json')
            if not m or 'hourly' not in m or not os.path.exists(fn):
                continue
            h = m['hourly']
            vals = h.get('sea_surface_temperature') or []
            if not any(v is not None for v in vals):
                continue
            with open(fn, encoding='utf-8') as f:
                d = json.load(f)
            d['sst'] = {'lat': m.get('latitude'), 'lon': m.get('longitude'), 'time': h.get('time', []), 't': vals}
            with open(fn, 'w', encoding='utf-8') as f:
                json.dump(d, f, separators=(',', ':'))
            sst_ok += 1
    print('температура воды:', sst_ok)
    with open(os.path.join(OUT, 'meta.json'), 'w', encoding='utf-8') as f:
        json.dump({'fetched': int(time.time()), 'lat0': LAT0, 'lat1': LAT1, 'lon0': LON0, 'lon1': LON1, 'step': STEP, 'points': ok, 'sst': sst_ok}, f)
    print('готово, файлов:', ok)


if __name__ == '__main__':
    main()
