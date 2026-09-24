import { closestTarget } from "./dom";

const TIP_SELECTOR = "[data-tip]";
const TIP_GAP = 8;

/** Place the tooltip above its target, or below when there is no room above. */
function place(tip: HTMLElement, target: HTMLElement): void {
  const box = target.getBoundingClientRect();
  const above = box.top - tip.offsetHeight - TIP_GAP;
  const top = above < TIP_GAP ? box.bottom + TIP_GAP : above;
  const maxLeft = window.innerWidth - tip.offsetWidth - TIP_GAP;
  const left = Math.max(TIP_GAP, Math.min(box.left, maxLeft));
  tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}

/** Show the tooltip text of a target. */
function show(tip: HTMLElement, target: HTMLElement): void {
  const text = target.dataset.tip;
  if (text === undefined || text === "") return;
  tip.textContent = text;
  tip.hidden = false;
  place(tip, target);
}

/** Wire one shared tooltip to every `[data-tip]` element, on hover and keyboard focus alike. */
export function initTooltip(): void {
  const tip = document.getElementById("tooltip");
  if (tip === null) return;
  const hide = (): void => {
    tip.hidden = true;
  };
  const enter = (event: Event): void => {
    const target = closestTarget(event, TIP_SELECTOR);
    if (target !== null) show(tip, target);
  };
  document.addEventListener("pointerover", enter);
  document.addEventListener("focusin", enter);
  document.addEventListener("pointerout", hide);
  document.addEventListener("focusout", hide);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hide();
  });
  window.addEventListener("scroll", hide, { passive: true });
}
