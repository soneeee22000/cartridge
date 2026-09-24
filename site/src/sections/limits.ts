import { LIMITATIONS, type LeadItem } from "../content/limits";
import { fullReport } from "../data/report";
import { fill, mount, richText } from "../lib/dom";
import { type CopyValues, copyValues } from "../viewmodel/values";

/** One list item with a bold lead. */
function itemMarkup(item: LeadItem, values: CopyValues): string {
  return `<li><strong>${richText(item.lead)}</strong> ${richText(fill(item.detail, values))}</li>`;
}

/** Section 8: what the numbers on this page cannot support. */
export function renderLimits(): void {
  const values = copyValues(fullReport);
  const items = LIMITATIONS.map((item) => itemMarkup(item, values)).join("");
  mount(
    "limits",
    `<div class="container">
      <div class="section-head"><h2 id="limits-title">Limitations</h2></div>
      <ul class="limits__list">${items}</ul>
    </div>`,
  );
}
