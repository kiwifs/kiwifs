import * as blk from "../blocks";
import { demoBacklinks, demoComments, demoSearch } from "./mockExtras";
import type { MockSavedView } from "@kw/components/__mocks__/data";

export const dataPages: Record<string, string> = {
  "dashboards/overview.md": `---
title: Coffee Atlas dashboard
type: dashboard
status: published
---

A living database of specialty coffee shops worldwide — ratings, roast profiles, and coordinates for map views. Records live in \`shops/\` as markdown with structured frontmatter; dashboards aggregate via DQL.

${blk.progress({
  type: "gauge",
  title: "Collection health",
  items: [
    { label: "Coverage", value: 87 },
    { label: "Geo-tagged", value: 100 },
    { label: "Reviewed (90d)", value: 72 },
    { label: "Avg rating", value: 47, max: 50 },
  ],
})}

${blk.columns("2:1", [
  `### Shops by city

${blk.chart({
  type: "bar",
  title: "Shops per city",
  xKey: "city",
  grid: true,
  legend: false,
  series: [{ key: "count", name: "Shops", color: "#6f4e37" }],
  data: [
    { city: "London", count: 2 },
    { city: "Tokyo", count: 1 },
    { city: "Melbourne", count: 1 },
    { city: "NYC", count: 1 },
    { city: "Portland", count: 1 },
    { city: "Seoul", count: 1 },
    { city: "Helsingborg", count: 1 },
    { city: "Mexico City", count: 1 },
  ],
})}

${blk.chart({
  type: "pie",
  title: "Roast style distribution",
  xKey: "style",
  legend: true,
  series: [{ key: "share", name: "Shops" }],
  data: [
    { style: "Light", share: 4 },
    { style: "Medium", share: 3 },
    { style: "Omni", share: 1 },
    { style: "Medium-dark", share: 1 },
  ],
})}`,
  `### Rating histogram

${blk.kiwiApp(
  240,
  `<!DOCTYPE html>
<html><head><style>
  body { font-family: system-ui, sans-serif; margin: 0; padding: 16px; background: var(--card,#faf8f5); color: var(--foreground,#1c1917); }
  h3 { font-size: 13px; font-weight: 600; margin: 0 0 12px; color: var(--muted-foreground,#78716c); text-transform: uppercase; letter-spacing: .06em; }
  .bars { display: flex; align-items: flex-end; gap: 6px; height: 140px; padding-top: 8px; }
  .bar-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .bar { width: 100%; border-radius: 4px 4px 0 0; background: linear-gradient(180deg, #c4a574 0%, #6f4e37 100%); min-height: 4px; transition: height .3s; }
  .label { font-size: 10px; color: var(--muted-foreground); }
  .count { font-size: 11px; font-weight: 600; }
</style></head><body>
  <h3>Rating distribution (9 shops)</h3>
  <div class="bars" id="bars"></div>
  <script>
    const data = [
      { rating: "4.4", count: 1, pct: 11 },
      { rating: "4.5", count: 1, pct: 11 },
      { rating: "4.6", count: 2, pct: 22 },
      { rating: "4.7", count: 2, pct: 22 },
      { rating: "4.8", count: 2, pct: 22 },
      { rating: "4.9", count: 1, pct: 11 },
    ];
    const max = Math.max(...data.map(d => d.count));
    document.getElementById('bars').innerHTML = data.map(d =>
      '<div class="bar-wrap"><div class="count">' + d.count + '</div>' +
      '<div class="bar" style="height:' + (d.count / max * 120) + 'px"></div>' +
      '<div class="label">' + d.rating + '</div></div>'
    ).join('');
  </script>
</body></html>`,
)}`,
])}

${blk.chart({
  type: "line",
  title: "Average rating trend (quarterly audits)",
  xKey: "quarter",
  grid: true,
  legend: true,
  series: [
    { key: "avg", name: "Avg rating", color: "#6f4e37" },
    { key: "shops", name: "Shops audited", color: "#c4a574" },
  ],
  data: [
    { quarter: "Q3 2025", avg: 4.52, shops: 5 },
    { quarter: "Q4 2025", avg: 4.58, shops: 7 },
    { quarter: "Q1 2026", avg: 4.64, shops: 8 },
    { quarter: "Q2 2026", avg: 4.67, shops: 9 },
  ],
})}

${blk.chart({
  type: "radar",
  title: "Quality dimensions (portfolio average)",
  xKey: "axis",
  legend: true,
  series: [
    { key: "score", name: "Score", color: "#8b6914" },
  ],
  data: [
    { axis: "Espresso", score: 88 },
    { axis: "Filter", score: 91 },
    { axis: "Service", score: 85 },
    { axis: "Ambience", score: 79 },
    { axis: "Food", score: 72 },
    { axis: "Consistency", score: 86 },
  ],
})}

${blk.playground({
  title: "Explore the atlas",
  widgets: [
    'filter city IN ["Tokyo", "London", "Melbourne", "NYC", "Helsingborg", "Portland", "Seoul", "Mexico City"]',
    "filter rating >= 4.5",
    'filter roast_style IN ["light", "medium", "omni", "medium-dark"]',
    "sort rating DESC",
    "layout map",
  ],
})}

${blk.colorPalette({
  name: "Roast spectrum",
  showContrast: true,
  size: "medium",
  colors: [
    { hex: "#f5efe6", label: "Light roast — cinnamon" },
    { hex: "#c4a574", label: "Medium — chestnut" },
    { hex: "#8b6914", label: "Medium-dark — cocoa" },
    { hex: "#3d2314", label: "Dark — French" },
    { hex: "#6f4e37", label: "Atlas accent" },
  ],
})}

${blk.queryTable('TABLE title, city, rating, roast_style FROM "shops/" WHERE rating >= 4.5 SORT rating DESC')}

${blk.queryTable('TABLE title, city, latitude, longitude FROM "shops/" WHERE city = "London"')}

> [!NOTE]
> Switch to **Bases** for table, cards, list, and map layouts. All shop records include \`latitude\` and \`longitude\` for geospatial views.
`,

  "shops/fuglen-tokyo.md": `---
title: Fuglen Tokyo
city: Tokyo
country: Japan
rating: 4.8
roast_style: light
latitude: 35.6654
longitude: 139.7089
location: Tomigaya, Shibuya
opened: 2014
price_tier: $$
tags: [scandinavian, filter, vintage]
last_visit: 2026-04-12
---

Norwegian transplant in Tomigaya — mid-century furniture showroom by day, serious light-roast bar by night. The team cups every lot before it hits the menu; expect Nordic-style filter with jasmine and bergamot notes on Ethiopian naturals.

## Tasting notes

- **Espresso:** Honey, orange zest, silky body — rarely bitter even at 1:2.5
- **Filter:** Washed Kenya with blackcurrant clarity; V60 on Modbar
- **Signature:** Cinnamon bun pairs well with their lighter roasts (Scandinavian tradition)

## Field notes

Visited during cherry blossom season. Queue was ~15 min at 10am Saturday. Baristas speak English; ask about the guest roaster rotation — Fuglen Oslo ships small lots monthly.

Cross-reference [[shops/koppi-helsingborg]] for the same Nordic roasting philosophy in Sweden. See [[dashboards/overview]] for portfolio stats.

${blk.chart({
  type: "bar",
  title: "Cupping scores (last 3 visits)",
  xKey: "visit",
  series: [{ key: "score", name: "Score /100", color: "#c4a574" }],
  data: [
    { visit: "Jan 2026", score: 87 },
    { visit: "Mar 2026", score: 89 },
    { visit: "Apr 2026", score: 91 },
  ],
})}
`,

  "shops/monmouth-borough.md": `---
title: Monmouth Coffee — Borough
city: London
country: UK
rating: 4.9
roast_style: medium
latitude: 51.5015
longitude: -0.0923
location: Borough Market
opened: 2007
price_tier: $$
tags: [institution, filter, single-origin]
last_visit: 2026-05-18
---

The Borough Market outpost that taught London to take filter seriously. Monmouth roasts in-house on a Probat — medium profile that lets origin character through without the brightness of third-wave light roasts.

## Why it matters

Monmouth predates the "specialty" label in the UK. Their cupping protocol still influences roasters like [[shops/origin-shoreditch]]. The queue is part of the ritual; order at the counter, collect when your name is called.

## Menu highlights

| Drink | Notes |
|-------|-------|
| Filter of the day | Rotates weekly; ask for tasting notes card |
| Espresso blend | Chocolate, hazelnut, low acidity |
| Cold brew | Summer only; steeped 18 h |

> [!TIP]
> Visit before 9am on weekdays to skip the market crush. Pair with a Neal's Yard cheese toastie from neighbouring stalls.

Linked: [[shops/origin-shoreditch]] (same city, different roast philosophy).
`,

  "shops/origin-shoreditch.md": `---
title: Origin Coffee — Shoreditch
city: London
country: UK
rating: 4.4
roast_style: medium
latitude: 51.5260
longitude: -0.0786
location: Charlotte Road
opened: 2012
price_tier: $$
tags: [training, cupping, events]
last_visit: 2026-03-02
---

Cornwall-roasted beans in an East London cupping lab. Origin runs SCA courses upstairs; the café downstairs is their public face. Medium roast profile — accessible for office crowds, still traceable to farm.

## Notes

- Strong focus on direct trade; ask about the current guest farm
- Less intense than [[shops/monmouth-borough]] but more educational programming
- Good for meetings — larger tables, quieter than Borough

Rating reflects consistency on filter; espresso can vary when trainees dial in.
`,

  "shops/market-lane-parliament.md": `---
title: Market Lane — Parliament
city: Melbourne
country: Australia
rating: 4.7
roast_style: light
latitude: -37.8136
longitude: 144.9631
location: Parliament Station
opened: 2009
price_tier: $$
tags: [australian, seasonal, filter]
last_visit: 2026-02-20
---

Melbourne's filter cathedral — standing room only, no laptops policy enforced kindly. Seasonal menu written on the wall; everything sourced through Market Lane's transparent supply chain.

## Service style

Baristas dial in each origin separately. If you're used to Starbucks defaults, ask for guidance — they'll walk you through fruit-forward naturals vs washed classics.

## Seasonal standout (Feb 2026)

Ethiopia Arbegona — peach, florals, tea-like finish. Best as pour-over; skip milk.

Compare roast approach with [[shops/fuglen-tokyo]] (both light, different hemispheres).
`,

  "shops/devocion-brooklyn.md": `---
title: Devoción — Brooklyn
city: NYC
country: USA
rating: 4.6
roast_style: medium
latitude: 40.7184
longitude: -73.9579
location: Williamsburg
opened: 2016
price_tier: $$$
tags: [colombian, vertical-integration, greenhouse]
last_visit: 2026-01-15
---

Williamsburg flagship with a living wall and beans air-freighted from Colombia within weeks of harvest. Devoción controls farm relationships end-to-end — medium roast to highlight caramel and red fruit without scorching.

## Space

Industrial loft, skylights, cupping table visible through glass. Price reflects freshness logistics; still worth it for Colombia-focused education.

## Order recommendation

Flat white with the House Blend; filter if they have a microlot on the board. Avoid peak brunch hours — seating is limited.
`,

  "shops/koppi-helsingborg.md": `---
title: Koppi
city: Helsingborg
country: Sweden
rating: 4.7
roast_style: light
latitude: 56.0465
longitude: 12.6945
location: Roastery & café
opened: 2007
price_tier: $$
tags: [roastery, nordic, competition]
last_visit: 2025-11-08
---

World Barista Championship alumni Charles Nystrand and Anne Lunell's roastery — light Scandinavian roasts before it was trendy. The café attached to the roaster is pilgrimage territory.

## Roasting philosophy

Development time ratio high; no oil on beans. Cupping room offers weekly public tastings (book online).

## Sister vibes

Same Nordic thread as [[shops/fuglen-tokyo]] — compare side-by-side in the [[dashboards/overview]] roast chart.

${blk.mermaid(`graph LR
  A[Green coffee] --> B[Probat sample roast]
  B --> C{Cupping pass?}
  C -->|Yes| D[Production roast]
  C -->|No| E[Reject / blend]
  D --> F[Café & wholesale]`)}
`,

  "shops/stumptown-ace-hotel.md": `---
title: Stumptown — Ace Hotel
city: Portland
country: USA
rating: 4.5
roast_style: medium-dark
latitude: 45.5231
longitude: -122.6765
location: West Burnside
opened: 2011
price_tier: $$
tags: [portland, hair-bender, classic]
last_visit: 2026-04-30
---

The lobby café that exported Portland coffee culture. Hair Bender blend still anchors the menu — medium-dark, chocolate-forward, forgiving in milk drinks.

## Context

Stumptown pioneered direct trade storytelling in the US. This location retains the original Ace Hotel aesthetic: worn leather, indie playlists, Chemex by the window.

## Honest take

Not the most experimental shop in Portland anymore, but consistency and milk texture remain excellent. For lighter roasts see [[shops/market-lane-parliament]] when travelling.
`,

  "shops/anthracite-hannam.md": `---
title: Anthracite Coffee — Hannam
city: Seoul
country: South Korea
rating: 4.8
roast_style: omni
latitude: 37.5344
longitude: 127.0012
location: Hannam-dong
opened: 2010
price_tier: $$
tags: [korean, omni, multi-location]
last_visit: 2026-03-22
---

Seoul's omni-roast pioneer — one profile designed to work for both espresso and filter. Hannam-dong flagship spans three floors: roastery basement, café ground, rooftop terrace.

## Omni means

Single roast curve per origin — baristas adjust extraction rather than roast level. Works surprisingly well for Korean café culture where customers switch between americano and hand drip.

## Must-try

Seasonal single-origin on Clever Dripper; ask for the Korean tasting note card (English on reverse).
`,

  "shops/cafe-avellaneda.md": `---
title: Café Avellaneda
city: Mexico City
country: Mexico
rating: 4.6
roast_style: light
latitude: 19.4126
longitude: -99.1719
location: Roma Norte
opened: 2015
price_tier: $$
tags: [mexican, chiapas, natural-process]
last_visit: 2026-05-01
---

Roma Norte hideaway championing Mexican micro-lots — light roast to preserve origin funk on naturals. Avellaneda works directly with Chiapas and Oaxaca producers; menu changes with harvest calendar.

## Atmosphere

Tile floors, open windows, mezcal cocktails after 5pm (coffee program stays serious). Staff bilingual; cupping flights available on Saturdays.

## Standout

Guatemala adjacent lots sometimes appear, but focus stays domestic — rare for a city flooded with imported greens.

See [[dashboards/overview]] for how Mexico City fits the global map.
`,

  "shops/onibus-coffee.md": `---
title: Onibus Coffee — Nakameguro
city: Tokyo
country: Japan
rating: 4.7
roast_style: light
latitude: 35.6467
longitude: 139.6983
location: Nakameguro
opened: 2016
price_tier: $$
tags: [japanese, minimalist, seasonal]
last_visit: 2026-04-08
---

Second Tokyo entry — smaller than [[shops/fuglen-tokyo]], tighter bar, same commitment to seasonal light roasts. Nakameguro canal views; no seats during peak hanami.

## Details

- Roasts on Fuji Royal in back room
- Guest roasters from Kyoto occasionally
- Pastries from local bakery; matcha cortado is a Tokyo thing here

Useful contrast when comparing Tokyo light-roast styles in Bases map view.
`,
};

export const dataMock = {
  views: [
    {
      name: "All shops",
      query: 'TABLE title, city, rating, roast_style FROM "shops/"',
      layout: "table",
      columns: [
        { key: "title", label: "Shop" },
        { key: "city", label: "City" },
        { key: "rating", label: "Rating" },
        { key: "roast_style", label: "Roast" },
        { key: "location", label: "Neighbourhood" },
      ],
      filters: [],
      sort: [{ key: "rating", direction: "desc" }],
    },
    {
      name: "Map",
      query: 'TABLE title, latitude, longitude FROM "shops/"',
      layout: "map",
      columns: [
        { key: "title", label: "Shop" },
        { key: "city", label: "City" },
        { key: "location", label: "Location" },
        { key: "latitude", label: "Lat" },
        { key: "longitude", label: "Lng" },
      ],
      filters: [],
      sort: [],
    },
    {
      name: "Cards",
      query: 'TABLE title, rating, roast_style FROM "shops/"',
      layout: "cards",
      columns: [
        { key: "title", label: "Shop" },
        { key: "rating", label: "Rating" },
        { key: "city", label: "City" },
        { key: "roast_style", label: "Roast" },
        { key: "tags", label: "Tags" },
      ],
      filters: [],
      sort: [{ key: "rating", direction: "desc" }],
    },
    {
      name: "List",
      query: 'TABLE title, city FROM "shops/"',
      layout: "list",
      columns: [
        { key: "title", label: "Shop" },
        { key: "city", label: "City" },
        { key: "rating", label: "Rating" },
      ],
      filters: [],
      sort: [{ key: "city", direction: "asc" }],
    },
  ] as MockSavedView[],
  viewResults: {
    "All shops": [
      { path: "shops/monmouth-borough.md", title: "Monmouth Coffee — Borough", city: "London", rating: 4.9, roast_style: "medium", location: "Borough Market" },
      { path: "shops/fuglen-tokyo.md", title: "Fuglen Tokyo", city: "Tokyo", rating: 4.8, roast_style: "light", location: "Tomigaya, Shibuya" },
      { path: "shops/anthracite-hannam.md", title: "Anthracite Coffee — Hannam", city: "Seoul", rating: 4.8, roast_style: "omni", location: "Hannam-dong" },
      { path: "shops/market-lane-parliament.md", title: "Market Lane — Parliament", city: "Melbourne", rating: 4.7, roast_style: "light", location: "Parliament Station" },
      { path: "shops/koppi-helsingborg.md", title: "Koppi", city: "Helsingborg", rating: 4.7, roast_style: "light", location: "Roastery & café" },
      { path: "shops/onibus-coffee.md", title: "Onibus Coffee — Nakameguro", city: "Tokyo", rating: 4.7, roast_style: "light", location: "Nakameguro" },
      { path: "shops/devocion-brooklyn.md", title: "Devoción — Brooklyn", city: "NYC", rating: 4.6, roast_style: "medium", location: "Williamsburg" },
      { path: "shops/cafe-avellaneda.md", title: "Café Avellaneda", city: "Mexico City", rating: 4.6, roast_style: "light", location: "Roma Norte" },
      { path: "shops/stumptown-ace-hotel.md", title: "Stumptown — Ace Hotel", city: "Portland", rating: 4.5, roast_style: "medium-dark", location: "West Burnside" },
      { path: "shops/origin-shoreditch.md", title: "Origin Coffee — Shoreditch", city: "London", rating: 4.4, roast_style: "medium", location: "Charlotte Road" },
    ],
    Map: [
      { path: "shops/fuglen-tokyo.md", title: "Fuglen Tokyo", city: "Tokyo", location: "Tomigaya, Shibuya", latitude: 35.6654, longitude: 139.7089 },
      { path: "shops/onibus-coffee.md", title: "Onibus Coffee — Nakameguro", city: "Tokyo", location: "Nakameguro", latitude: 35.6467, longitude: 139.6983 },
      { path: "shops/monmouth-borough.md", title: "Monmouth Coffee — Borough", city: "London", location: "Borough Market", latitude: 51.5015, longitude: -0.0923 },
      { path: "shops/origin-shoreditch.md", title: "Origin Coffee — Shoreditch", city: "London", location: "Charlotte Road", latitude: 51.5260, longitude: -0.0786 },
      { path: "shops/market-lane-parliament.md", title: "Market Lane — Parliament", city: "Melbourne", location: "Parliament Station", latitude: -37.8136, longitude: 144.9631 },
      { path: "shops/devocion-brooklyn.md", title: "Devoción — Brooklyn", city: "NYC", location: "Williamsburg", latitude: 40.7184, longitude: -73.9579 },
      { path: "shops/koppi-helsingborg.md", title: "Koppi", city: "Helsingborg", location: "Roastery & café", latitude: 56.0465, longitude: 12.6945 },
      { path: "shops/stumptown-ace-hotel.md", title: "Stumptown — Ace Hotel", city: "Portland", location: "West Burnside", latitude: 45.5231, longitude: -122.6765 },
      { path: "shops/anthracite-hannam.md", title: "Anthracite Coffee — Hannam", city: "Seoul", location: "Hannam-dong", latitude: 37.5344, longitude: 127.0012 },
      { path: "shops/cafe-avellaneda.md", title: "Café Avellaneda", city: "Mexico City", location: "Roma Norte", latitude: 19.4126, longitude: -99.1719 },
    ],
    Cards: [
      { path: "shops/monmouth-borough.md", title: "Monmouth Coffee — Borough", rating: 4.9, city: "London", roast_style: "medium", tags: "institution, filter" },
      { path: "shops/fuglen-tokyo.md", title: "Fuglen Tokyo", rating: 4.8, city: "Tokyo", roast_style: "light", tags: "scandinavian, vintage" },
      { path: "shops/anthracite-hannam.md", title: "Anthracite Coffee — Hannam", rating: 4.8, city: "Seoul", roast_style: "omni", tags: "korean, multi-location" },
      { path: "shops/market-lane-parliament.md", title: "Market Lane — Parliament", rating: 4.7, city: "Melbourne", roast_style: "light", tags: "australian, seasonal" },
      { path: "shops/koppi-helsingborg.md", title: "Koppi", rating: 4.7, city: "Helsingborg", roast_style: "light", tags: "roastery, nordic" },
      { path: "shops/onibus-coffee.md", title: "Onibus Coffee — Nakameguro", rating: 4.7, city: "Tokyo", roast_style: "light", tags: "japanese, minimalist" },
      { path: "shops/devocion-brooklyn.md", title: "Devoción — Brooklyn", rating: 4.6, city: "NYC", roast_style: "medium", tags: "colombian, greenhouse" },
      { path: "shops/cafe-avellaneda.md", title: "Café Avellaneda", rating: 4.6, city: "Mexico City", roast_style: "light", tags: "mexican, natural-process" },
    ],
    List: [
      { path: "shops/cafe-avellaneda.md", title: "Café Avellaneda", city: "Mexico City", rating: 4.6 },
      { path: "shops/koppi-helsingborg.md", title: "Koppi", city: "Helsingborg", rating: 4.7 },
      { path: "shops/monmouth-borough.md", title: "Monmouth Coffee — Borough", city: "London", rating: 4.9 },
      { path: "shops/origin-shoreditch.md", title: "Origin Coffee — Shoreditch", city: "London", rating: 4.4 },
      { path: "shops/market-lane-parliament.md", title: "Market Lane — Parliament", city: "Melbourne", rating: 4.7 },
      { path: "shops/devocion-brooklyn.md", title: "Devoción — Brooklyn", city: "NYC", rating: 4.6 },
      { path: "shops/stumptown-ace-hotel.md", title: "Stumptown — Ace Hotel", city: "Portland", rating: 4.5 },
      { path: "shops/anthracite-hannam.md", title: "Anthracite Coffee — Hannam", city: "Seoul", rating: 4.8 },
      { path: "shops/fuglen-tokyo.md", title: "Fuglen Tokyo", city: "Tokyo", rating: 4.8 },
      { path: "shops/onibus-coffee.md", title: "Onibus Coffee — Nakameguro", city: "Tokyo", rating: 4.7 },
    ],
  },
  queryRows: [
    { _path: "shops/monmouth-borough.md", title: "Monmouth Coffee — Borough", city: "London", rating: 4.9, roast_style: "medium" },
    { _path: "shops/fuglen-tokyo.md", title: "Fuglen Tokyo", city: "Tokyo", rating: 4.8, roast_style: "light" },
    { _path: "shops/anthracite-hannam.md", title: "Anthracite Coffee — Hannam", city: "Seoul", rating: 4.8, roast_style: "omni" },
    { _path: "shops/market-lane-parliament.md", title: "Market Lane — Parliament", city: "Melbourne", rating: 4.7, roast_style: "light" },
    { _path: "shops/koppi-helsingborg.md", title: "Koppi", city: "Helsingborg", rating: 4.7, roast_style: "light" },
    { _path: "shops/onibus-coffee.md", title: "Onibus Coffee — Nakameguro", city: "Tokyo", rating: 4.7, roast_style: "light" },
    { _path: "shops/devocion-brooklyn.md", title: "Devoción — Brooklyn", city: "NYC", rating: 4.6, roast_style: "medium" },
    { _path: "shops/cafe-avellaneda.md", title: "Café Avellaneda", city: "Mexico City", rating: 4.6, roast_style: "light" },
    { _path: "shops/stumptown-ace-hotel.md", title: "Stumptown — Ace Hotel", city: "Portland", rating: 4.5, roast_style: "medium-dark" },
    { _path: "shops/origin-shoreditch.md", title: "Origin Coffee — Shoreditch", city: "London", rating: 4.4, roast_style: "medium" },
  ],
  searchResults: demoSearch([
    { path: "shops/fuglen-tokyo.md", score: 0.94, snippet: "...Nordic-style <mark>filter</mark> with jasmine and bergamot notes..." },
    { path: "shops/monmouth-borough.md", score: 0.91, snippet: "...taught London to take <mark>filter</mark> seriously..." },
    { path: "dashboards/overview.md", score: 0.86, snippet: "...<mark>rating</mark> histogram and roast spectrum palette..." },
    { path: "shops/koppi-helsingborg.md", score: 0.82, snippet: "...light Scandinavian <mark>roasts</mark> before it was trendy..." },
  ]),
  backlinks: demoBacklinks([
    { path: "dashboards/overview.md", count: 4 },
    { path: "shops/fuglen-tokyo.md", count: 2 },
    { path: "shops/koppi-helsingborg.md", count: 2 },
  ]),
  comments: demoComments("shops/monmouth-borough.md", [
    {
      id: "c1",
      anchor: { quote: "4.9", prefix: "rating: ", suffix: "\nroast" },
      body: "Worth bumping after the new Probat calibration? Last visit was exceptional.",
      author: "alex",
      createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
      resolved: false,
    },
  ]),
  metaResults: [
    { path: "shops/fuglen-tokyo.md", frontmatter: { title: "Fuglen Tokyo", city: "Tokyo", rating: 4.8, roast_style: "light" } },
    { path: "shops/monmouth-borough.md", frontmatter: { title: "Monmouth Coffee — Borough", city: "London", rating: 4.9, roast_style: "medium" } },
    { path: "dashboards/overview.md", frontmatter: { title: "Coffee Atlas dashboard", type: "dashboard" } },
  ],
};
