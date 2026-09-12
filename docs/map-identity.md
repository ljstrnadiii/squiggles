# Map identity and recent maps

The top-right identity control represents the owner of the map currently on screen. It uses the owner's existing Google display name and picture, with initials as the fallback. It does not create a Squiggles profile or expose a directory of users.

- An owned map is labeled `My map`.
- Another owner's published map shows that owner's name.
- An administrator opening a private dataset sees `Admin preview`.
- The control contains one avatar. Account actions live in the same menu instead of adding a second identity control.

## Recent maps

Only published map URLs a viewer explicitly opens can become recent maps. Anonymous visits are held in browser storage and merged into private account metadata after login. Authenticated recent maps are stored as map references, ordered by last view, and capped server-side. No user search, friend graph, suggestions, or map discovery is provided.

Signing in from a published map returns the viewer to that same URL. It does not silently switch datasets.

## Query isolation

Browser query tabs are keyed by dataset or published-map route. A newly opened dataset does not inherit tabs from another map: it starts with one `All Activities` query in 2D, and the initial camera is fit to the dataset bounds. Explicit published links still load the query tabs and camera that the owner intentionally published.

The map switcher links `My map` to the owner's private dataset route. Published views remain separate, intentional share artifacts.
