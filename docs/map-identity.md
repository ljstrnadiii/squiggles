# Map identity and favorites

Each account owns one stable map ID and canonical URL, `/m/:mapId`. The map ID belongs to the account rather than to an uploaded dataset or a publish event, so replacing or recompiling an archive does not change the user's map URL. Dataset IDs remain backend implementation details.

The header separates map context from account context:

- The map-context control contains the current map owner's avatar and the active saved-view name.
- Opening that control reveals the owner's name, the available views, and a `Like map` action when viewing someone else's map.
- The far-right settings control contains account/navigation actions and never changes identity when switching maps.
- An administrator opening another user's map uses the same canonical map URL with admin-preview permissions.

Squiggles does not create public user profiles, expose a directory, or infer social relationships.

## Saved views

A map does not need to be published before it has a URL. Owners can save the current query tabs, camera, and map settings as the map's saved state. `Save` updates that state; it does not create a second public-map identity.

Existing `/p/:slug` links remain compatibility aliases. Opening one resolves to its owner's canonical `/m/:mapId` URL so old shared links continue to work.

## Favorites

Maps are retained only through an explicit `Like map` action. Simply opening a shared map does not add it to any history or navigation list.

Liked maps appear under `Favorites`, keyed by their stable map IDs. A user can remove a map from Favorites by selecting the liked state again. Historical automatically recorded recent-map rows are ignored unless they were explicitly marked as favorites.

Signing in from another user's map returns the viewer to that same map. It does not silently switch to their own map.

## Navigation

The flat account menu contains `My map`, `Favorites`, `Account`, `Upload`, `Save`, `Share`, and `Logout`. `Save` is available on the owner's own map; `Share` copies the stable canonical map URL.

The map-context dropdown is responsible for map-owner identity and switching among the map's saved views. This avoids showing two copies of the same avatar when a user is viewing their own map.

## Query isolation

Browser query tabs are keyed by map ID. A newly encountered map without a saved view starts with one `All Activities` query in 2D and fits the camera to the current dataset bounds. A saved view restores the tabs and camera intentionally saved by the owner.

Admin `View map` uses the same canonical `/m/:mapId` URL with admin-preview permissions rather than exposing a private dataset route.
