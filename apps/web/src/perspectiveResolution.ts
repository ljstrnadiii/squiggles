const CIRCUMFERENCE = 2 * Math.PI * 6_378_137;
type Position = { lng: number; lat: number };
function mercator(position: Position): [number, number] {
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, position.lat)) * Math.PI / 180;
  return [position.lng / 360 * CIRCUMFERENCE, Math.log(Math.tan(Math.PI / 4 + latitude / 2)) * CIRCUMFERENCE / (2 * Math.PI)];
}

/** Sample the most demanding local camera scale, without averaging in the horizon. */
export function perspectivePixelMeters(width: number, height: number, unproject: (point: [number, number]) => Position): number {
  let minimum = Infinity;
  for (const fx of [0.15, 0.5, 0.85]) {
    for (const fy of [0.35, 0.65, 0.9]) {
      const x = width * fx, y = height * fy;
      const center = mercator(unproject([x, y]));
      const right = mercator(unproject([x + 1, y]));
      const below = mercator(unproject([x, y + 1]));
      // The smaller singular value of the screen-to-Mercator Jacobian is the
      // direction with the greatest screen-space magnification.
      const a = right[0] - center[0], b = below[0] - center[0];
      const c = right[1] - center[1], d = below[1] - center[1];
      const trace = a * a + b * b + c * c + d * d;
      const determinant = (a * d - b * c) ** 2;
      const largest = (trace + Math.sqrt(Math.max(0, trace * trace - 4 * determinant))) / 2;
      const scale = Math.sqrt(determinant / largest);
      if (Number.isFinite(scale) && scale > 0) minimum = Math.min(minimum, scale);
    }
  }
  return minimum;
}
