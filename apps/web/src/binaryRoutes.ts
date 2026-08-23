import type { BinaryAttribute } from "@deck.gl/core";

import type { BinaryRouteBatch, RouteMetadata } from "./contracts";

export type BinaryPathData = {
  length: number;
  startIndices: Uint32Array;
  attributes: Record<string, BinaryAttribute>;
};

/** deck.gl's binary PathLayer contract, backed by the original GeoArrow values. */
export function binaryPathData(batch: BinaryRouteBatch, colors?: Uint8Array): BinaryPathData {
  return {
    length: batch.segmentActivityIndices.length,
    startIndices: batch.startIndices,
    attributes: {
      getPath: { value: batch.positions, size: 2 },
      ...(colors ? { getColor: { value: colors, size: 4 } } : {}),
    },
  };
}

export function pickedActivity(batch: BinaryRouteBatch, segmentIndex: number): RouteMetadata | null {
  const activityIndex = batch.segmentActivityIndices[segmentIndex];
  return activityIndex === undefined ? null : batch.activities[activityIndex] ?? null;
}

export function routeColors(
  batch: BinaryRouteBatch,
  colorForActivity: (activity: RouteMetadata) => readonly [number, number, number, number],
): Uint8Array {
  // PathLayer's binary contract requires every non-geometry attribute to use
  // the geometry's vertex layout, even when one color represents a full route.
  const colors = new Uint8Array(batch.positions.length / 2 * 4);
  batch.segmentActivityIndices.forEach((activityIndex, segmentIndex) => {
    const color = colorForActivity(batch.activities[activityIndex]);
    for (let point = batch.startIndices[segmentIndex]; point < batch.startIndices[segmentIndex + 1]; point += 1) {
      colors.set(color, point * 4);
    }
  });
  return colors;
}
