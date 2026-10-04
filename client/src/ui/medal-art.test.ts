// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { MEDALS } from "@racing/shared";
import { medalBadge } from "./medal-art";

function render(markup: string): SVGSVGElement {
  const host = document.createElement("div");
  host.innerHTML = markup;
  return host.querySelector("svg")!;
}

const ids = (svg: SVGSVGElement) => [...svg.querySelectorAll("[id]")].map((el) => el.id);

describe("medalBadge", () => {
  it("names the tier for assistive technology, or hides it when decorative", () => {
    const svg = render(medalBadge("gold", "lb-medal-badge"));
    expect([...svg.classList]).toEqual(["medal-badge", "medal-gold", "lb-medal-badge"]);
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("Gold medal");
    const decorative = render(medalBadge("gold", "", { decorative: true }));
    expect(decorative.getAttribute("aria-hidden")).toBe("true");
    expect(decorative.hasAttribute("role")).toBe(false);
  });

  it.each(MEDALS)(
    "gives each %s badge its own ids, every reference resolving inside it",
    (medal) => {
      const [a, b] = [render(medalBadge(medal)), render(medalBadge(medal))];
      expect(ids(a).length).toBeGreaterThan(0);
      expect(ids(a).filter((id) => ids(b).includes(id))).toEqual([]);
      for (const svg of [a, b]) {
        const references = [...svg.outerHTML.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]);
        expect(references.filter((id) => !ids(svg).includes(id))).toEqual([]);
      }
    },
  );

  it("draws an unearned tier as an empty slot", () => {
    const svg = render(medalBadge("silver", "", { empty: true }));
    expect(svg.classList).toContain("medal-empty");
    expect(svg.getAttribute("aria-label")).toBe("Silver medal (not earned)");
    expect(svg.innerHTML).not.toContain("url(#");
  });
});
