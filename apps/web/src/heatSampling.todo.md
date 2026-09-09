Wiring steps:
1. Request a budget-safe overview for the visible viewport.
2. Run the existing heat scorer on that overview.
3. Convert per-activity heat scores plus desired-LOD vertex counts into a retained activity set with `heatBudgetActivityIds`.
4. Request the finer LOD only for retained ids; use padded bounds only for that fetch/cache query.
5. Reuse the same heat result for coloring when heat is enabled.
