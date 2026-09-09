Heat-prioritized sampling integration contract

- Sampling is evaluated against the settled visible viewport, never padded prefetch bounds.
- If the desired LOD fits the vertex budget, keep every activity.
- If it is over budget, use the existing screen-space heat score as redundancy priority.
- Lower heat survives first; hotter/more redundant activities are dropped until the desired LOD fits.
- Heat scoring should use the existing `heat.ts` implementation so heat colors and redundancy ranking share one definition.
- Padded fetch bounds may still be used for cache/pan smoothness after the retained activity set is chosen.
