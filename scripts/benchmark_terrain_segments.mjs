// Synthetic CPU/index benchmark. Run with Node 22.18+; GPU frame timing is separate.
import { SegmentIndex } from "../apps/web/src/segmentIndex.ts";
const segmentCount = 1_250_000;
const endpoints = new Float32Array(segmentCount * 4);
for (let i = 0; i < segmentCount; i++) {
  const x = ((i * 7919) % 100003) / 100003;
  const y = ((i * 104729) % 100019) / 100019;
  endpoints.set([x, y, x + 0.0001, y + 0.0001], i * 4);
}
const started = performance.now();
const index = new SegmentIndex(endpoints);
const built = performance.now();
let submittedSegments = 0;
for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
  submittedSegments += index.query([x / 8, y / 8, (x + 1) / 8, (y + 1) / 8]).length;
}
console.log(JSON.stringify({
  segmentCount, tileCount: 64,
  beforeSubmittedSegments: segmentCount * 64,
  afterSubmittedSegments: submittedSegments,
  avoidedPercent: 100 * (1 - submittedSegments / (segmentCount * 64)),
  indexBuildMs: performance.now() - started - (performance.now() - built),
  tileQueriesMs: performance.now() - built,
}, null, 2));
