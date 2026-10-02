import { DndContext, DragOverlay, PointerSensor, pointerWithin, rectIntersection, useDraggable, useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent } from '@dnd-kit/core';

// Drop where the pointer is: prefer the item under the pointer, then its container, then the closest overlap.
const collide: CollisionDetection = args => {
  const hits = pointerWithin(args);
  const item = hits.find(h => String(h.id).startsWith('o:'));
  if (item) return [item];
  if (hits.length) return [hits[0]];
  return rectIntersection(args);
};
import { useState, type ReactNode } from 'react';

export interface DropTarget { container: string; beforeId: string | null }

/**
 * Drag items between containers (sprints, columns, phases) and in front of other items.
 * Items register as both draggable and droppable; containers are droppable for "append to the end".
 */
export function DnD({ children, onDrop, overlay }: { children: ReactNode; onDrop: (id: string, to: DropTarget) => void; overlay: (id: string) => ReactNode }) {
  const [active, setActive] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const end = (e: DragEndEvent) => {
    setActive(null);
    const over = e.over;
    if (!over) return;
    const id = String(e.active.id).slice(2), od = over.data.current as { container: string; item?: string } | undefined;
    if (!od) return;
    if (od.item === id) return;
    onDrop(id, { container: od.container, beforeId: od.item || null });
  };
  return (
    <DndContext sensors={sensors} collisionDetection={collide} onDragStart={e => setActive(String(e.active.id).slice(2))} onDragEnd={end} onDragCancel={() => setActive(null)}>
      {children}
      <DragOverlay dropAnimation={{ duration: 160, easing: 'ease-out' }}>{active ? <div className="dragghost">{overlay(active)}</div> : null}</DragOverlay>
    </DndContext>
  );
}

export function useItem(id: string, container: string) {
  const d = useDraggable({ id: 'i:' + id });
  const o = useDroppable({ id: 'o:' + id, data: { container, item: id } });
  return {
    ref: (el: HTMLElement | null) => { d.setNodeRef(el); o.setNodeRef(el) },
    handle: d.listeners,
    dragging: d.isDragging,
    over: o.isOver && !d.isDragging,
  };
}
export function useZone(container: string) {
  const o = useDroppable({ id: 'z:' + container, data: { container } });
  return { ref: o.setNodeRef, over: o.isOver };
}

/** Rank that places an item before `beforeId` in `list` (sorted by rank), or at the end. */
export function rankBefore<T extends { id: string; rank: number }>(list: T[], id: string, beforeId: string | null): number {
  const l = list.filter(x => x.id !== id);
  const i = beforeId ? l.findIndex(x => x.id === beforeId) : -1;
  if (i < 0) return (l.length ? Math.max(...l.map(x => +x.rank || 0)) : 0) + 1;
  const b = +l[i].rank || 0, a = i > 0 ? +l[i - 1].rank || 0 : b - 2;
  return (a + b) / 2;
}
