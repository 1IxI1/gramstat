// Package ui serves the dashboard files shipped with the API binary.
package ui

import (
	"embed"
	"io/fs"
	"net/http"
	"path"
	"strconv"
)

// Keep this list explicit: the source directory also contains tests and notes.
//
//go:embed index.html style.css favicon.svg ton-mark.svg world-map.svg
//go:embed app.mjs scroll-brand.mjs account-types.mjs action-types.mjs catalogue.mjs charts.mjs data.mjs wire.mjs
//go:embed time-ranges.mjs wallet-registry.mjs wallet-activations.mjs stake-registry.mjs validator-map.mjs
//go:embed fonts/InterVariable.woff2 fonts/InterVariable-Italic.woff2 fonts/OFL.txt
var files embed.FS

func Handler() http.Handler {
	types := map[string]string{".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
		".svg": "image/svg+xml", ".mjs": "text/javascript; charset=utf-8", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8"}
	assets := make(map[string]http.HandlerFunc)
	err := fs.WalkDir(files, ".", func(name string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		data, err := files.ReadFile(name)
		if err != nil {
			return err
		}
		typ, length := types[path.Ext(name)], strconv.Itoa(len(data))
		cache := "no-cache"
		if path.Ext(name) == ".woff2" {
			cache = "public, max-age=604800"
		}
		assets["/"+name] = func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", typ)
			w.Header().Set("Content-Length", length)
			w.Header().Set("Cache-Control", cache)
			if r.Method != http.MethodHead {
				_, _ = w.Write(data)
			}
		}
		return nil
	})
	if err != nil {
		panic(err) // An invalid embedded filesystem is a build error.
	}
	assets["/"] = assets["/index.html"]
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		file := assets[r.URL.EscapedPath()]
		if file == nil {
			http.NotFound(w, r)
			return
		}
		file(w, r)
	})
}
