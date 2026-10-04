import { MEDAL_LABELS, type Medal } from "@racing/shared";

export interface MedalBadgeOptions {
  /** An unearned tier: the Medal's silhouette as an empty slot, drawn in currentColor. */
  empty?: boolean;
  /** Hidden from assistive technology, for where nearby text already names the Medal. */
  decorative?: boolean;
}

/** Struck-metal tones, from the specular highlight down to the darkest edge. */
interface Finish {
  hi: string;
  light: string;
  base: string;
  dark: string;
  edge: string;
}

/** A ribbon colour and its stripes, each spanning a fraction of the strap's width. */
interface Ribbon {
  color: string;
  stripes: readonly (readonly [from: number, to: number, color: string])[];
}

type Disc = Exclude<Medal, "author">;

const FINISHES: Record<Disc, Finish> = {
  bronze: { hi: "#ffe0bf", light: "#f0a868", base: "#b8682f", dark: "#6b3410", edge: "#4a230a" },
  silver: { hi: "#ffffff", light: "#e6ebf0", base: "#a9b4bf", dark: "#56616d", edge: "#39424c" },
  gold: { hi: "#fffbe0", light: "#ffe27a", base: "#e0a81e", dark: "#8a5a00", edge: "#5c3c00" },
};

const RIBBONS: Record<Medal, Ribbon> = {
  bronze: { color: "#b3362b", stripes: [[0.4, 0.6, "#f3dcc0"]] },
  silver: { color: "#2f5fb3", stripes: [[0.38, 0.62, "#f1f5f9"]] },
  gold: {
    color: "#c8102e",
    stripes: [
      [0.14, 0.26, "#f7d154"],
      [0.74, 0.86, "#f7d154"],
    ],
  },
  author: {
    color: "#3b2a8c",
    stripes: [
      [0.2, 0.27, "#c084fc"],
      [0.42, 0.58, "#2dd4bf"],
      [0.73, 0.8, "#c084fc"],
    ],
  },
};

// Every gradient, pattern and clip id carries a per-badge prefix: many badges share a page.
let serial = 0;

const f = (n: number): number => +n.toFixed(2);

type Point = readonly [number, number];

function lerp([ax, ay]: Point, [bx, by]: Point, t: number): Point {
  return [ax + (bx - ax) * t, ay + (by - ay) * t];
}

function points(list: readonly Point[]): string {
  return list.map(([x, y]) => `${f(x)},${f(y)}`).join(" ");
}

/** A star path; four points make a sparkle. */
function star(cx: number, cy: number, outer: number, inner: number, count = 5): string {
  const corners = Array.from({ length: count * 2 }, (_, i) => {
    const r = i % 2 ? inner : outer,
      angle = (Math.PI * i) / count - Math.PI / 2;
    return `${f(cx + r * Math.cos(angle))} ${f(cy + r * Math.sin(angle))}`;
  });
  return `M${corners.join("L")}Z`;
}

/** The Author gem's outline: flat-topped, centred where the discs are. */
function octagon(r: number): Point[] {
  return Array.from({ length: 8 }, (_, k) => {
    const angle = ((22.5 + 45 * k) * Math.PI) / 180;
    return [32 + r * Math.cos(angle), 40 + r * Math.sin(angle)] as const;
  });
}

// The ribbon: two straps crossing behind the medal, the left one in front.
const STRAP: readonly Point[] = [
  [12, 0],
  [24, 0],
  [38, 22],
  [29, 26],
];
const mirror = (strap: readonly Point[]): Point[] => strap.map(([x, y]) => [64 - x, y] as const);

function stripe(strap: readonly Point[], from: number, to: number): Point[] {
  const [topLeft, topRight, bottomRight, bottomLeft] = strap;
  return [
    lerp(topLeft, topRight, from),
    lerp(topLeft, topRight, to),
    lerp(bottomLeft, bottomRight, to),
    lerp(bottomLeft, bottomRight, from),
  ];
}

function ribbon(medal: Medal, id: string): string {
  const { color, stripes } = RIBBONS[medal];
  const strap = (shape: readonly Point[], behind: boolean) =>
    `<polygon points="${points(shape)}" fill="${color}"/>${stripes.map(([from, to, tone]) => `<polygon points="${points(stripe(shape, from, to))}" fill="${tone}"/>`).join("")}<polygon points="${points(shape)}" fill="url(#${id}-fold)"/>${behind ? `<polygon points="${points(shape)}" fill="#000" opacity=".28"/>` : ""}`;
  return strap(mirror(STRAP), true) + strap(STRAP, false);
}

/** An emblem drawn in one paint, so it can be stamped in shadow, highlight and metal. */
type Emblem = (paint: string, detail: string) => string;

const EMBLEMS: Record<Disc, Emblem> = {
  // A single star: the first rung.
  bronze: (paint) => `<path d="${star(32, 40.6, 9.6, 4.1)}" fill="${paint}"/>`,
  // Crossed chequered flags.
  silver: (paint, cloth) => {
    const flag = `<g transform="translate(24.5 52) rotate(29)"><path d="M0 0V-25" stroke="${paint}" stroke-width="1.5" stroke-linecap="round"/><circle cy="-25.4" r="1.3" fill="${paint}"/><path d="M.6-24.6C4.2-26.4 7.4-22.6 11.2-24.2V-16.4C7.4-14.8 4.2-18.6.6-16.8Z" fill="${cloth}"/></g>`;
    return `${flag}<g transform="matrix(-1 0 0 1 64 0)">${flag}</g>`;
  },
  // A victor's laurel wreath around a star.
  gold: (paint) => `${wreath(paint)}<path d="${star(32, 40.2, 6.2, 2.6)}" fill="${paint}"/>`,
};

/** A point on the laurel's arc, `degrees` clockwise from the right. */
function onWreath(degrees: number): Point {
  const a = (degrees * Math.PI) / 180;
  return [32 + 11.4 * Math.cos(a), 41 + 11.4 * Math.sin(a)];
}

function leaf([x, y]: Point, angle: number): string {
  return `<path d="M0 0Q1.9-1.45 3.9 0Q1.9 1.45 0 0Z" transform="translate(${f(x)} ${f(y)}) rotate(${angle})"/>`;
}

// The left laurel branch grows up from the bottom, a leaf pair at each step and one at the tip.
const [STEM_START, STEM_END] = [onWreath(96), onWreath(238)];
const STEM = `M${f(STEM_START[0])} ${f(STEM_START[1])}A11.4 11.4 0 0 1 ${f(STEM_END[0])} ${f(STEM_END[1])}`;
const LEAVES =
  [102, 119, 136, 153, 170, 187, 204, 221]
    .map((d) => leaf(onWreath(d), d + 40) + leaf(onWreath(d), d + 140))
    .join("") + leaf(STEM_END, 328);

/** The left branch and its mirror image on the right. */
function wreath(paint: string): string {
  const branch = `<path d="${STEM}" fill="none" stroke="${paint}" stroke-width=".9"/><g fill="${paint}">${LEAVES}</g>`;
  return `${branch}<g transform="matrix(-1 0 0 1 64 0)">${branch}</g>`;
}

function discDefs(medal: Disc, id: string): string {
  const { hi, light, base, dark } = FINISHES[medal];
  return `<linearGradient id="${id}-rim" x1=".15" y1=".05" x2=".85" y2=".95"><stop offset="0" stop-color="${hi}"/><stop offset=".3" stop-color="${light}"/><stop offset=".62" stop-color="${base}"/><stop offset="1" stop-color="${dark}"/></linearGradient><radialGradient id="${id}-face" cx=".38" cy=".3" r=".78"><stop offset="0" stop-color="${hi}"/><stop offset=".28" stop-color="${light}"/><stop offset=".68" stop-color="${base}"/><stop offset="1" stop-color="${dark}"/></radialGradient><linearGradient id="${id}-bevel" x1=".2" y1="0" x2=".8" y2="1"><stop offset="0" stop-color="${dark}"/><stop offset="1" stop-color="${hi}"/></linearGradient><linearGradient id="${id}-emboss" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hi}"/><stop offset=".55" stop-color="${light}"/><stop offset="1" stop-color="${base}"/></linearGradient>${medal === "silver" ? `<pattern id="${id}-check" width="3" height="3" patternUnits="userSpaceOnUse"><rect width="3" height="3" fill="#f4f7fa"/><path d="M0 0H1.5V1.5H0ZM1.5 1.5H3V3H1.5Z" fill="#4a5562"/></pattern>` : ""}`;
}

function disc(medal: Disc, id: string): string {
  const { hi, dark, edge } = FINISHES[medal];
  const emblem = EMBLEMS[medal];
  // Milled for silver, beaded for gold: the rim grows grander with the tier.
  const milling = {
    bronze: "",
    silver: `<circle cx="32" cy="40" r="19.3" fill="none" stroke="${dark}" stroke-width="1.6" stroke-dasharray=".7 .9" opacity=".45"/>`,
    gold: `<circle cx="32" cy="40" r="19.2" fill="none" stroke="${hi}" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="0 3.016" opacity=".85"/>`,
  }[medal];
  return `<rect x="28" y="15.5" width="8" height="6" rx="2" fill="url(#${id}-rim)" stroke="${edge}" stroke-width=".6"/><circle cx="32" cy="41.6" r="21" fill="#000" opacity=".3"/><circle cx="32" cy="40" r="21" fill="url(#${id}-rim)" stroke="${edge}" stroke-width=".7"/>${milling}<circle cx="32" cy="40" r="17" fill="url(#${id}-face)"/><circle cx="32" cy="40" r="17" fill="none" stroke="url(#${id}-bevel)" stroke-width="1.2"/><g transform="translate(.5 .8)" opacity=".55">${emblem(dark, dark)}</g><g transform="translate(-.4 -.5)" opacity=".8">${emblem(hi, hi)}</g>${emblem(`url(#${id}-emboss)`, `url(#${id}-${medal === "silver" ? "check" : "emboss"})`)}`;
}

const OUTER = octagon(22.5);
const BODY = octagon(19.5);
const TABLE = octagon(11);

function authorDefs(id: string): string {
  return `<linearGradient id="${id}-rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f3e8ff"/><stop offset=".35" stop-color="#a78bfa"/><stop offset=".7" stop-color="#5b21b6"/><stop offset="1" stop-color="#1e1b4b"/></linearGradient><linearGradient id="${id}-iris" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5eead4"/><stop offset=".3" stop-color="#38bdf8"/><stop offset=".55" stop-color="#818cf8"/><stop offset=".78" stop-color="#c084fc"/><stop offset="1" stop-color="#f0abfc"/></linearGradient><linearGradient id="${id}-table" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#99f6e4"/><stop offset=".4" stop-color="#60a5fa"/><stop offset=".7" stop-color="#a78bfa"/><stop offset="1" stop-color="#f5d0fe"/></linearGradient>`;
}

/** A cut gem: light from the top left catches the upper facets and leaves the lower ones dark. */
function gem(id: string): string {
  const facets = BODY.map((corner, k) => {
    const next = (k + 1) % 8;
    const light = Math.cos(((45 * (k + 1) - 225) * Math.PI) / 180);
    const tone = light > 0 ? "#fff" : "#000";
    return `<polygon points="${points([corner, BODY[next], TABLE[next], TABLE[k]])}" fill="${tone}" opacity="${f(Math.abs(light) * (light > 0 ? 0.42 : 0.38))}"/>`;
  }).join("");
  return `<rect x="28" y="15.5" width="8" height="6" rx="2" fill="url(#${id}-rim)" stroke="#1e1b4b" stroke-width=".6"/><polygon points="${points(OUTER)}" fill="#000" opacity=".3" transform="translate(0 1.6)"/><polygon points="${points(OUTER)}" fill="url(#${id}-rim)" stroke="#1e1b4b" stroke-width=".7"/><polygon points="${points(BODY)}" fill="url(#${id}-iris)"/>${facets}<polygon points="${points(TABLE)}" fill="url(#${id}-table)" stroke="#fff" stroke-width=".5" stroke-opacity=".6"/><path d="${star(32, 40, 4.2, 1.2, 4)}" fill="#fff" opacity=".7" transform="rotate(45 32 40)"/><path d="${star(32, 40, 7.5, 1.7, 4)}" fill="#fff"/><path class="medal-sparkle" d="${star(51.5, 20.5, 3.6, 0.8, 4)}" fill="#fff"/><path class="medal-sparkle" d="${star(12, 55, 2.6, 0.6, 4)}" fill="#fff"/>`;
}

/** The empty slot: the tier's silhouette, dashed, so an unearned Medal still shows its shape. */
function slot(medal: Medal): string {
  const straps = [mirror(STRAP), STRAP]
    .map((strap) => `<polygon points="${points(strap)}"/>`)
    .join("");
  const body =
    medal === "author"
      ? `<polygon points="${points(OUTER)}" fill="currentColor" fill-opacity=".06" stroke-dasharray="3.2 2.2"/><polygon points="${points(TABLE)}" fill="currentColor" fill-opacity=".14" stroke="none"/>`
      : `<circle cx="32" cy="40" r="21" fill="currentColor" fill-opacity=".06" stroke-dasharray="3.3 2.2"/>`;
  const emblem = medal === "author" ? "" : EMBLEMS[medal]("currentColor", "currentColor");
  return `<g fill="none" stroke="currentColor" stroke-linejoin="round"><g stroke-width="1" opacity=".4">${straps}</g><g stroke-width="1.4">${body}</g></g><g opacity=".32">${emblem}</g>`;
}

/**
 * Inline SVG artwork for one Medal tier, shared by the HUD and the Lobby. Each tier is
 * its own design, escalating in grandeur: a bronze star, silver crossed chequered flags,
 * a gold laurel wreath and the Author's iridescent cut gem. An earned badge carries a
 * hidden `.medal-shine` band, clipped to the medal, for CSS to sweep across it.
 */
export function medalBadge(
  medal: Medal,
  className = "",
  { empty = false, decorative = false }: MedalBadgeOptions = {},
): string {
  const label = `${MEDAL_LABELS[medal]} medal${empty ? " (not earned)" : ""}`;
  const a11y = decorative ? 'aria-hidden="true"' : `role="img" aria-label="${label}"`;
  const classes = ["medal-badge", `medal-${medal}`, empty ? "medal-empty" : "", className]
    .filter(Boolean)
    .join(" ");
  const open = `<svg class="${classes}" viewBox="0 0 64 64" ${a11y}>`;
  if (empty) return `${open}${slot(medal)}</svg>`;
  const id = `medal-${++serial}`;
  const outline =
    medal === "author"
      ? `<polygon points="${points(OUTER)}"/>`
      : `<circle cx="32" cy="40" r="21"/>`;
  const defs = `<defs>${medal === "author" ? authorDefs(id) : discDefs(medal, id)}<linearGradient id="${id}-fold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-opacity="0"/><stop offset="1" stop-opacity=".45"/></linearGradient><radialGradient id="${id}-spec"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient><linearGradient id="${id}-shine"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient><clipPath id="${id}-clip">${outline}</clipPath></defs>`;
  const body = medal === "author" ? gem(id) : disc(medal, id);
  const specular = `<ellipse cx="25" cy="31" rx="10" ry="5" fill="url(#${id}-spec)" transform="rotate(-35 25 31)" opacity=".75"/>`;
  const shine = `<g clip-path="url(#${id}-clip)"><g transform="rotate(24 32 40)"><rect class="medal-shine" x="2" y="0" width="9" height="80" fill="url(#${id}-shine)" opacity="0"/></g></g>`;
  return `${open}${defs}${ribbon(medal, id)}${body}${specular}${shine}</svg>`;
}
