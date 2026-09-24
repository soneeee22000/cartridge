import { describe, expect, it } from "vitest";
import { breakable, esc, fill, joinList, richText } from "./dom";

describe("markup helpers", () => {
  it("escapes HTML-significant characters", () => {
    expect(esc(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });

  it("allows breaks after underscores in identifiers", () => {
    expect(breakable("write_on_non_root")).toBe(
      "write_<wbr>on_<wbr>non_<wbr>root",
    );
  });

  it("renders code spans and https links after escaping", () => {
    expect(
      richText("Use `--all` <now>, see [docs](https://example.org/a)"),
    ).toBe(
      'Use <code>--all</code> &lt;now&gt;, see <a href="https://example.org/a">docs</a>',
    );
  });

  it("does not turn non-https links into anchors", () => {
    expect(richText("[x](javascript:alert)")).toBe("[x](javascript:alert)");
  });

  it("fills placeholders and rejects missing ones", () => {
    expect(fill("{runs} runs, {seeds} seeds", { runs: 8000, seeds: 200 })).toBe(
      "8000 runs, 200 seeds",
    );
    expect(() => fill("{missing}", {})).toThrow(/missing/);
  });

  it("joins lists in plain English", () => {
    expect(joinList([])).toBe("");
    expect(joinList(["a"])).toBe("a");
    expect(joinList(["a", "b"])).toBe("a and b");
    expect(joinList(["a", "b", "c"])).toBe("a, b and c");
  });
});
