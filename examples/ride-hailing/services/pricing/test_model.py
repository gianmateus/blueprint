from model import quote_price


def test_quote_is_positive():
    assert quote_price({"lat": 0, "lng": 0}, {"lat": 0.1, "lng": 0}) > 0
