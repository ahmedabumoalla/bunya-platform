// All admin overlays share one lock so closing nested dialogs in any order
// restores the page's original scrolling only after the final overlay closes.
const locks = new Set<symbol>();
let previousOverflow = "";
let previousPriority = "";

export function lockBodyScroll() {
  const token = Symbol("body-scroll-lock");
  const style = document.body.style;
  if (locks.size === 0) {
    previousOverflow = style.getPropertyValue("overflow");
    previousPriority = style.getPropertyPriority("overflow");
    style.setProperty("overflow", "hidden");
  }
  locks.add(token);

  return () => {
    if (!locks.delete(token) || locks.size > 0) return;
    if (previousOverflow) {
      style.setProperty("overflow", previousOverflow, previousPriority);
    } else {
      style.removeProperty("overflow");
    }
  };
}
