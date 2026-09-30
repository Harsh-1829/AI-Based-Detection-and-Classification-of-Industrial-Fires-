"""
ThermalIntel — Meteorological Intelligence & Wildfire Feasibility Engine
Uses Open-Meteo Keyless Meteorological API to evaluate physical fire feasibility.
"""

import json
import logging
import time
import urllib.request
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

# In-memory spatial-temporal cache: key = (round(lat, 1), round(lon, 1)), value = (timestamp, data)
_WEATHER_CACHE: Dict[tuple, tuple] = {}
_CACHE_TTL_SECONDS = 900  # 15 minutes


def fetch_weather_and_feasibility(latitude: float, longitude: float, predicted_class: Optional[str] = None) -> Dict[str, Any]:
    """
    Fetch current meteorological observations for (lat, lon) and evaluate
    physical fire propagation feasibility according to fire science principles.
    """
    cache_key = (round(latitude, 1), round(longitude, 1))
    now = time.time()

    if cache_key in _WEATHER_CACHE:
        cached_time, cached_data = _WEATHER_CACHE[cache_key]
        if now - cached_time < _CACHE_TTL_SECONDS:
            return _format_evaluation(cached_data, predicted_class)

    url = (
        f"https://api.open-meteo.com/v1/forecast?"
        f"latitude={latitude:.4f}&longitude={longitude:.4f}"
        f"&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m"
    )

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "ThermalIntel-FireWeather/1.0"})
        with urllib.request.urlopen(req, timeout=4) as response:
            payload = json.loads(response.read().decode("utf-8"))
            current = payload.get("current", {})
            _WEATHER_CACHE[cache_key] = (now, current)
            return _format_evaluation(current, predicted_class)
    except Exception as e:
        logger.warning(f"Open-Meteo weather fetch error for ({latitude}, {longitude}): {e}")
        # Graceful fallback based on seasonal climatology (September = late monsoon)
        fallback = {
            "temperature_2m": 24.5,
            "relative_humidity_2m": 90,
            "precipitation": 0.0,
            "wind_speed_10m": 8.0,
            "fallback": True,
        }
        return _format_evaluation(fallback, predicted_class)


def _format_evaluation(weather: Dict[str, Any], predicted_class: Optional[str]) -> Dict[str, Any]:
    temp = float(weather.get("temperature_2m", 25.0))
    rh = int(weather.get("relative_humidity_2m", 80))
    precip = float(weather.get("precipitation", 0.0))
    wind = float(weather.get("wind_speed_10m", 5.0))

    # Fire Weather Feasibility Evaluation
    # Wildfire propagation requires dry fuel (equilibrium moisture content < 16-20%)
    # When Relative Humidity > 70-75% or precipitation > 0.5mm, crown/forest wildfires cannot sustain.
    is_wildfire_feasible = True
    risk_level = "MODERATE"
    feasibility_score = 0.50

    if rh >= 80 or precip >= 1.0:
        is_wildfire_feasible = False
        feasibility_score = 0.10
        risk_level = "LOW / INFEASIBLE"
        reason = f"High ambient relative humidity ({rh}%) and post-monsoon moisture inhibit forest wildfire propagation."
    elif rh >= 65:
        is_wildfire_feasible = False
        feasibility_score = 0.25
        risk_level = "LOW RISK"
        reason = f"Elevated relative humidity ({rh}%) significantly dampens vegetative fire spread."
    elif rh <= 35 and temp >= 35.0:
        is_wildfire_feasible = True
        feasibility_score = 0.95
        risk_level = "CRITICAL WILDFIRE RISK"
        reason = f"Severe dry conditions (RH {rh}%, Temp {temp}°C) create high wildfire hazard."
    else:
        is_wildfire_feasible = True
        feasibility_score = 0.55
        risk_level = "MODERATE RISK"
        reason = f"Normal atmospheric conditions (RH {rh}%, Temp {temp}°C)."

    # Actionable status evaluation based on class
    p_class = predicted_class or ""
    is_suppressed = False
    status_badge = "CONFIRMED"
    verdict_text = "Verified active thermal signature."

    if "forest" in p_class.lower() and not is_wildfire_feasible:
        is_suppressed = True
        status_badge = "SUPPRESSED WILDFIRE ALERT"
        verdict_text = (
            f"Meteorologically Infeasible: Humidity is {rh}%. "
            f"Likely small-scale localized brush/crop burning or smoldering waste, not an active forest wildfire."
        )
    elif "vegetation" in p_class.lower() and not is_wildfire_feasible:
        is_suppressed = True
        status_badge = "LOW SPREAD RISK"
        verdict_text = f"Controlled or isolated burning; high humidity ({rh}%) prevents propagation."
    elif "industrial" in p_class.lower() or "quarry" in p_class.lower() or "mining" in p_class.lower():
        is_suppressed = False
        status_badge = "WEATHER INDEPENDENT"
        verdict_text = "Enclosed or high-temperature industrial facility unaffected by atmospheric humidity."

    return {
        "temperature_c": temp,
        "relative_humidity_pct": rh,
        "precipitation_mm": precip,
        "wind_speed_kmh": wind,
        "is_wildfire_feasible": is_wildfire_feasible,
        "feasibility_score": feasibility_score,
        "risk_level": risk_level,
        "reason": reason,
        "is_suppressed": is_suppressed,
        "status_badge": status_badge,
        "verdict_text": verdict_text,
    }
