# Where the data comes from

All of the map's data comes from public sources. It's gathered and processed ahead of time with `npm run data`, so the app itself doesn't depend on those services being up.

| What | Source |
| --- | --- |
| The basin's outline | USGS Watershed Boundary Dataset (the Lake Tahoe watershed) |
| Trails | OpenStreetMap, plus the U.S. Forest Service's official trail inventory |
| Lakes, wilderness areas, state parks, peaks, towns | OpenStreetMap |
| Terrain and lake depth | AWS Terrain Tiles (USGS elevation data) |
| The 2026 trail plan | The Forest Service's Basin Wide Trails Analysis project maps |

## What counts as a trail

The goal is to show the trails a hiker or mountain biker would actually use. The map includes:

- **Named** paths and trails that touch the basin, including dirt roads that are signed or designated as trails
- **Forest Service inventory trails** that OpenStreetMap is missing

It leaves out:

- climbing approaches
- informal or private paths
- paved bike paths
- sidewalks
- motorized, off-highway-vehicle, and winter-only routes

Trails that match the Forest Service's inventory get an **Official trail** stamp.

Pieces of a trail that share a name and connect are joined into one trail. The Tahoe Rim Trail, Pacific Crest Trail, and Tahoe–Yosemite Trail are always kept whole.

## How bike access is decided

Bike access comes from the data when the data says:

- OpenStreetMap bicycle tags, including mountain bike difficulty ratings
- Forest Service management records

When neither source says, the map makes an educated guess:

- **Forest Service land:** bikes are assumed allowed
- **Wilderness areas and state parks:** bikes are assumed not allowed
- **Pacific Crest Trail:** never open to bikes

Trail cards mark guessed access as "likely allowed".

## Limits

- **Simplified terrain.** Terrain is sampled every 50 meters and heights are exaggerated about 2.3×, so slopes look steeper than they are. Climbing figures are estimates.
- **Snapshots, not live data.** The map is only as current as the last time the data was refreshed. OpenStreetMap is updated by volunteers and can have gaps or errors.
- **Nicknames aren't searchable.** Some well-known local names may not appear if the data files the trail under its official name. For example, "Mr. Toad's" is part of the Saxon Creek area.

Always confirm access and conditions with the land manager before heading out.
