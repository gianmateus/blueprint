package main

import (
	"log"
	"net/http"

	"github.com/ride/geo/handlers"
)

func main() {
	http.HandleFunc("/locate", handlers.Locate)
	log.Println("geo service on :4004")
	log.Fatal(http.ListenAndServe(":4004", nil))
}
