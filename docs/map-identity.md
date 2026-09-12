# Map identity and recent maps

Each account owns one stable map ID and canonical URL, `/m/:mapId`. The map ID belongs to the account rather than to an uploaded dataset or a publish event, so replacing or recompiling an archive does not change the user's map URL. Dataset IDs remain backend implementation details.

The top-right identity control represents the owner of the map currently on screen. It uses the owner's existing Google display name and picture, with initials as the fallback. It does not create a Squiggles profile or expose a directory of users.

- An owned map is labeled `My map`.
- Another owner's map shows that owner's name.
- An administrator opening another user's map sees `Admin preview` on the same canonical map URL.
- The control contains one avatar. Account actions live in the same menu instead of adding a second identity control.

## Saved views

A map does not need to be published before it has a URL. Owners can save the current query tabs, camera, and map settings as the map's saved view. `Save view` updates that state; it does not create a second public-map identity.

Existing `/p/:slug` links remain compatibility aliases. Opening one resolves to its owner's canonical `/m/:mapId` URL so old shared links continue to work.

## Recent maps

Only map URLs a viewer explicitly opens can become recent maps. Anonymous visits are held in browser storage and merged into private account metadata after login. Authenticated recent maps store stable map IDs, are ordered by last view, and are capped server-side. No user search, friend graph, suggestions, or map discovery is provided.

Signing in from another user's map returns the viewer to that same map. It does not silently switch to their own map.

## Query isolation

Browser query tabs are keyed by map ID. A newly encountered map without a saved view starts with one `All Activities` query in 2D and fits the camera to the current dataset bounds. A saved view restores the tabs and camera intentionally saved by the owner.

The map switcher links `My map` to the account's canonical `/m/:mapId` URL. Admin `View map` uses that same URL with admin-preview permissions rather than exposing a private dataset route.