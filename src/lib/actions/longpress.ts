/**
 * A long press on a tile opens its details (touch and pen; the button at the tile's end does the same for everyone).
 * The click that follows the press is swallowed, so the service isn't launched as well.
 */
export function longpress(node: HTMLElement, open: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let fired = false, touch = false, x = 0, y = 0;
  const down = (e: PointerEvent) => {
    touch = e.pointerType !== 'mouse';
    fired = false;
    if (!touch) return;
    x = e.clientX; y = e.clientY;
    timer = setTimeout(() => { fired = true; open(); }, 450);
  };
  const move = (e: PointerEvent) => { if (Math.hypot(e.clientX - x, e.clientY - y) > 10) clearTimeout(timer); };
  const cancel = () => clearTimeout(timer);
  const click = (e: MouseEvent) => { if (fired) { e.preventDefault(); fired = false; } };
  // the browser's own long-press menu would cover the sheet
  const menu = (e: Event) => { if (touch) e.preventDefault(); };
  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', cancel);
  node.addEventListener('pointercancel', cancel);
  node.addEventListener('click', click);
  node.addEventListener('contextmenu', menu);
  return {
    destroy() {
      clearTimeout(timer);
      node.removeEventListener('pointerdown', down); node.removeEventListener('pointermove', move); node.removeEventListener('pointerup', cancel);
      node.removeEventListener('pointercancel', cancel); node.removeEventListener('click', click); node.removeEventListener('contextmenu', menu);
    }
  };
}
