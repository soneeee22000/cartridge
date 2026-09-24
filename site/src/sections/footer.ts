import { ADRS, AUTHOR_URL, REPO_URL, repoFile } from "../content/links";
import { esc, mount } from "../lib/dom";
import { CLEAN_ROOM_LINE } from "./hero";

/** The footer: author, repository, ADRs, licence and the clean-room line. */
export function renderFooter(): void {
  const adrs = ADRS.map(
    (adr) =>
      `<li><a href="${repoFile(adr.path)}">${esc(adr.id)}: ${esc(adr.title)}</a></li>`,
  ).join("");
  mount(
    "footer",
    `<div class="container site-footer__inner">
      <p>Built by <a href="${AUTHOR_URL}">Pyae Sone (Seon)</a>.</p>
      <p>Source: <a href="${REPO_URL}">github.com/soneeee22000/cartridge</a>, MIT License.</p>
      <div><p>Architecture decisions:</p><ul class="site-footer__adrs">${adrs}</ul></div>
      <p class="muted">${esc(CLEAN_ROOM_LINE)} Figures come from the committed reports in <code>reports/committed/</code>; the replay serves recorded model calls.</p>
    </div>`,
  );
}
