package store

import "os"

type Driver struct {
	ID  string  `json:"id"`
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

var redisURL = os.Getenv("REDIS_URL")

// Nearby would run GEOSEARCH against Redis; here it returns a fixed fleet.
func Nearby(lat, lng float64, limit int) []Driver {
	_ = redisURL
	return []Driver{{ID: "d1", Lat: lat + 0.01, Lng: lng}, {ID: "d2", Lat: lat, Lng: lng - 0.01}}[:limit-1]
}
