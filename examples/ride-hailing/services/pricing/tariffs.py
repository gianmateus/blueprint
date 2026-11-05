BASE_FARE = 2.5
PER_KM = 1.2


def surge_for(km):
    return 1.3 if km < 2 else 1.0
