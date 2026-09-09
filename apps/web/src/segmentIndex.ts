export type Rect = readonly [number, number, number, number];
type Node = { bounds: Rect; start: number; end: number; left?: Node; right?: Node };
const intersects = (a: Rect, b: Rect) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

/** A binary spatial index over segment bboxes; crossing segments stay eligible. */
export class SegmentIndex {
  private order: Uint32Array;
  private root?: Node;
  private endpoints: Float32Array;
  constructor(endpoints: Float32Array) {
    this.endpoints = endpoints;
    this.order = Uint32Array.from({ length: endpoints.length / 4 }, (_, i) => i);
    if (this.order.length) this.root = this.build(0, this.order.length);
  }
  private bounds(id: number): Rect {
    const offset = id * 4, e = this.endpoints;
    return [Math.min(e[offset], e[offset + 2]), Math.min(e[offset + 1], e[offset + 3]), Math.max(e[offset], e[offset + 2]), Math.max(e[offset + 1], e[offset + 3])];
  }
  private build(start: number, end: number): Node {
    let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
    for (let i = start; i < end; i++) {
      const b = this.bounds(this.order[i]);
      xmin = Math.min(xmin, b[0]); ymin = Math.min(ymin, b[1]);
      xmax = Math.max(xmax, b[2]); ymax = Math.max(ymax, b[3]);
    }
    const node: Node = { bounds: [xmin, ymin, xmax, ymax], start, end };
    if (end - start <= 64) return node;
    const axis = xmax - xmin >= ymax - ymin ? 0 : 1;
    const middle = axis === 0 ? (xmin + xmax) / 2 : (ymin + ymax) / 2;
    let split = start;
    for (let i = start; i < end; i++) {
      const offset = this.order[i] * 4 + axis;
      if ((this.endpoints[offset] + this.endpoints[offset + 2]) / 2 < middle) {
        const previous = this.order[split]; this.order[split++] = this.order[i]; this.order[i] = previous;
      }
    }
    if (split === start || split === end) return node;
    node.left = this.build(start, split); node.right = this.build(split, end);
    return node;
  }
  query(bounds: Rect): number[] {
    const result: number[] = [];
    const visit = (node: Node) => {
      if (!intersects(node.bounds, bounds)) return;
      if (node.left && node.right) { visit(node.left); visit(node.right); return; }
      for (let i = node.start; i < node.end; i++) {
        const id = this.order[i];
        if (intersects(this.bounds(id), bounds)) result.push(id);
      }
    };
    if (this.root) visit(this.root);
    // Preserve route compositing order across adjacent tiles and index partitions.
    return result.sort((a, b) => a - b);
  }
}
