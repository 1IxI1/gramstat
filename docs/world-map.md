# Validator world map

`ui/world-map.svg` is a static, low-detail Natural Earth 1:110m land outline
and country borders. It is served locally; the map uses no tiles, map service,
runtime dependencies, zoom or tracking requests.

Source: `https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json`
(Natural Earth 4.1.0). Natural Earth map data is
[public domain](https://www.naturalearthdata.com/about/terms-of-use/).

To regenerate, in a temporary tools directory install `d3-geo@3.1.1` and
`topojson-client@3.1.0`, download the source JSON, then run:

```sh
node --input-type=module - countries-110m.json /path/to/gramstat/ui/world-map.svg < /path/to/gramstat/docs/build-world-map.mjs
```

The equirectangular projection is shared with `projectLocation` in
`ui/validator-map.mjs`: a 1000×500 viewBox, 960×480 world, 20/10 margins.
Coordinates are never jittered or replaced by country centroids.

The map requests `/api/v1/locations?at=<inclusive-end-second>`.
It displays the latest prepared, roster-matched snapshot whose exclusive
`data_through` is at most `at + 1`, even for a range shorter than a round.
This is round-snapshot history, not arbitrary-second reconstruction. The
snapshot time and round are visible; later observations are never substituted.

A full-width history chart below the map combines validators with coordinates
(left axis) and observed countries (right axis). Points use `geo_data_through - 1`,
the last included second of each snapshot, rather than round-start dates. Only
points inside the selected timestamp range are plotted; missing rounds and
snapshots break the lines. The country count retains the source's observed-country
definition, which can include validators with a known country but no coordinates.

The non-draggable `Map snapshot` marker uses the actual displayed snapshot time.
If the latest available snapshot predates a short selection, a labelled left-edge
marker says `before range`. No marker is shown while the map is loading or when
the snapshot is unavailable. Dragging a range on this chart uses the shared UTC
range selector and automatically reloads the map for its inclusive end second.

Exact coordinate matches share a marker; its size increases with the count.
Country counts include only plotted validators. Unknown or invalid coordinates
are omitted and counted separately, including an entirely unlocated snapshot.
