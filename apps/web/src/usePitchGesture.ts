import { useRef, type PointerEvent, type MouseEvent } from "react";
import type { MapState } from "./contracts";
import { normalizeCamera } from "./camera";

/** Continue the first Ctrl-drag across the switch from the flat renderer to terrain. */
export function usePitchGesture(enabled: boolean, view: MapState, onView: (view: MapState) => void) {
  const gesture = useRef<{ pointerId: number; x: number; y: number; view: MapState } | null>(null);
  const suppressClick = useRef(false);

  function finish(event: PointerEvent<HTMLElement>) {
    if (gesture.current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return {
    onPointerDownCapture(event: PointerEvent<HTMLElement>) {
      if (!enabled || !event.ctrlKey || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, view: { ...view, pitch: 0, bearing: 0 } };
      suppressClick.current = true;
    },
    onPointerMoveCapture(event: PointerEvent<HTMLElement>) {
      const start = gesture.current;
      if (!start || start.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      if (Math.hypot(dx, dy) < 3) return;
      onView(normalizeCamera({ ...start.view, pitch: -dy * 0.5, bearing: dx * 0.8 }));
    },
    onPointerUpCapture: finish,
    onPointerCancelCapture: finish,
    onClickCapture(event: MouseEvent<HTMLElement>) {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
    onContextMenu(event: MouseEvent<HTMLElement>) {
      if (gesture.current || enabled && event.ctrlKey) event.preventDefault();
    },
  };
}
