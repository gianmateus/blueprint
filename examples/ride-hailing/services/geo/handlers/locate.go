package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/ride/geo/store"
)

// Locate returns drivers near the requested point.
func Locate(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	lat, _ := strconv.ParseFloat(q.Get("lat"), 64)
	lng, _ := strconv.ParseFloat(q.Get("lng"), 64)
	json.NewEncoder(w).Encode(store.Nearby(lat, lng, 3))
}
