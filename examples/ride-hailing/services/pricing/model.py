import math
from tariffs import BASE_FARE, PER_KM, surge_for


def distance_km(a, b):
    return math.hypot(a["lat"] - b["lat"], a["lng"] - b["lng"]) * 111


def quote_price(origin, destination):
    km = distance_km(origin, destination)
    return round((BASE_FARE + PER_KM * km) * surge_for(km), 2)
