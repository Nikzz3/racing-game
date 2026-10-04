# Vehicle design references for the detailed Blender fleet

Research date: 2026-10-04. Scope: eight visually different, fictional game vehicles,
using manufacturer photographs and specifications to establish believable proportions
and construction. These are reference studies, not licensed replicas. Manufacturer
photographs are inspection references only; do not ship them as textures or artwork.

## Main finding

Different paint and bolt-on trim cannot make a shared generic car shell convincing.
Each vehicle needs its own wheelbase, overhangs, roof profile, window opening, fender
volume, and front aperture layout. Model large forms first, then panel construction,
then small details. The recommendations below are modeling judgments derived from the
linked references; they are not claims that the fictional vehicles reproduce them.

Use realistic curvature across broad sheet metal, with tight radii at manufactured
edges. A flatter front means a defined hood leading edge, upright or inclined fascia,
recessed lamps, and separate bumper sections—not zero curvature everywhere.

## Proportion anchors

Dimensions are millimeters. Ratios are calculated from those dimensions. Widths use
the manufacturer's stated body/overall width, except Defender's folded-mirror width.
Trim, market, and ride-height differences matter; these are visual anchors, not a
physics change request. Keep existing game pivots and handling contracts.

| Game class     | Reference                                  |                      Length | Width |    Height | Wheelbase | Height / width | Wheelbase / length |
| -------------- | ------------------------------------------ | --------------------------: | ----: | --------: | --------: | -------------: | -----------------: |
| Race GT        | 2025 Porsche 911 GT3                       |                        4570 |  1852 |      1279 |      2457 |          0.691 |              0.538 |
| Futuristic     | Lamborghini Temerario                      |                        4706 |  1996 |      1201 |      2658 |          0.602 |              0.565 |
| Sports sedan   | 2025 BMW M3, US published inches converted |                        4803 |  1887 |      1438 |      2858 |          0.762 |              0.595 |
| Hot hatch      | 2025 Volkswagen Golf GTI, AU               |                        4289 |  1789 |      1472 |      2631 |          0.823 |              0.613 |
| SUV            | Defender 110, air suspension               | 4758 body / 5018 with spare |  2008 |      1967 |      3022 |          0.980 |         0.635 body |
| Classic taxi   | 1995 Toyota Crown Comfort                  |                        4695 |  1695 |      1515 |      2785 |          0.894 |              0.593 |
| Police cruiser | 2023 Dodge Charger Pursuit                 |                        5040 |  1905 |      1482 |      3052 |          0.778 |              0.606 |
| Cargo van      | Transit Custom L1, June 2024 EU sheet      |                        5050 |  2032 | 1959–2040 |      3100 |    0.964–1.004 |              0.614 |

Sources: [Porsche technical data](https://newsroom.porsche.com/dam/jcr%3A46cb0e24-ad5a-489c-a404-52c678071d03/pag-911-gt3-mt-en.pdf.PDF),
[Lamborghini technical brochure](https://www.lamborghini.com/original/DAM/lamborghini/facelift_2019/model_detail/temerario/temerario/brochure/09_05/Lamborghini_Huracan_634_Phev.pdf),
[BMW specifications](https://www.press.bmwgroup.com/usa/article/detail/T0442408EN_US/the-new-2025-bmw-m3?language=en_US),
[Volkswagen technical specifications, p.13](https://www.volkswagen.com.au/idhub/content/dam/onehub_pkw/importers/au/pdfs/showroom-brochures-live/VW_GOLF_MY25_Spec_May25.pdf),
[Defender dimensions, p.29](https://www.landrover.com/content/dam/lrdx/pdfs/no/brochures/Defender.pdf),
[Toyota launch specification image](https://global.toyota/pages/news/older/images/1995/12/19/003_en.gif),
[Stellantis Charger specification sheet, p.3](https://www.stellantisfleet.com/content/dam/fca-fleet/na/fleet/en_us/dodge/2023/charger-pursuit/specifications/1864_ChargerPursuit_2023_01.pdf),
[Ford June 2024 technical sheet](https://media.ford.com/content/dam/fordmedia/Europe/documents/productReleases/E-TransitCustom/TransitCustom_specsheet_EU_June2024_EU.pdf).
The older Stellantis/Ford PDFs remained search-indexed with their specifications but
did not reliably open during research; do not depend on them for embedded artwork.

## 1. Race GT: compact rear-engine coupe

The GT3 study supplies low height, wide rear shoulders, an arched roof flowing into a
short rear deck, and a hood sitting between raised front fenders. Porsche documents
four-point headlamps, larger front air inlets, hood outlets, a separate spoiler lip,
fixed rear wing, center-lock wheels, and two central exhausts. Front and rear rims
are 20 and 21 inches respectively.
[Porsche design explanation and photo galleries](https://newsroom.porsche.com/en/press-kits/911-GT3/Aerodynamics-and-design.html).

Modeling direction: keep the hood center relatively flat; give it two deliberate
outer creases instead of an inflated oval nose. Form a broad low central radiator
opening and two brake ducts with visible depth. Set four small projector elements
inside each dark, glazed lamp housing. Use the wing's actual airfoil, two supports,
and end plates; add rear deck cooling slats and a finned lower diffuser. Separate
rear wheel width from front wheel width. Use thin, divided spokes and visible brake
discs, rather than solid silver wheel plates.

Primary photo reference: [front and rear three-quarter pair](https://porschepictures.flowcenter.de/pmdb/thumbnail.cgi?crop=1&cs=f0a148f568621e60&h=912&id=298392&public=1&w=1620).
The [rear grille close-up](https://porschepictures.flowcenter.de/pmdb/thumbnail.cgi?crop=1&cs=6a621388da1c5617&h=812&id=298500&public=1&w=1440)
is useful for the depth order: outer lip, fine mesh, dark mechanical recess.

## 2. Futuristic: low mid-engine wedge

Lamborghini identifies hexagonal daytime-running lights, exposed engine, side
intakes, front splitter, and functional rear spoiler as the Temerario's exterior
themes. [Manufacturer model page](https://www.lamborghini.com/en-en/models/temerario).

The [first-party front three-quarter photo](https://www.lamborghini.com/sites/it-en/files/DAM/lamborghini/facelift_2019/model_detail/temerario/temerario/temerario_og.jpg)
shows a low spear-shaped hood, slit headlamp housings above separate DRL openings,
and a deeply concave door surface leading to a large side intake. The canopy is
short and low, with a strongly inclined windshield. These forms should define the
fictional hypercar before decorative lighting is added.

Modeling direction: use flat/slightly crowned hood planes, angular fender shoulders,
triangular side inlet mouths with a dark back wall, and a broad rear engine cover.
Separate the upper projector lamps from lower geometric DRLs. Add an exposed rear
diffuser and paired geometric rear lamp housings, as studied in the
[manufacturer rear photograph](https://www.lamborghini.com/sites/it-en/files/DAM/lamborghini/news/2024/08_16_temerario_lancio/temerario_10.jpg).
Use open polygonal/split spokes and thin tire sidewalls. Do not recycle the GT coupe
roof or sedan's long cabin.

## 3. Sports sedan: rear-drive four-door performance car

BMW's 2025 M3 uses two arrow-like vertical LED elements per headlamp module and
offers dark lamp internals. Its 18/19-inch base wheel combination and available
19/20-inch forged wheels provide useful alternatives to the GT coupe's wheel design.
[BMW design and specification release](https://www.press.bmwgroup.com/usa/article/detail/T0442408EN_US/the-new-2025-bmw-m3?language=en_US).

Modeling direction: long hood, set-back cabin, clearly separate trunk, four usable
door openings, and flared rear arches. Make a crisp shoulder transition and a lower
door concavity rather than a uniformly convex side. Build two tall central grille
recesses plus smaller outer bumper ducts, with narrow lamps tying into the fenders.
Use dual-spoke alloys, a small trunk lip, quad round exhausts, and a black diffuser.
The [BMW rear photograph](https://www.press.bmwgroup.com/usa/photo/detail/P90551003/The-new-BMW-M3-Sedan-05-2024)
shows the bumper's volume above the diffuser, recessed plate surround, wraparound
lamp shapes, and four separated exhaust tips. Use those layers instead of attaching
exhaust cylinders directly to an undifferentiated rear box.

## 4. Hot hatch: short two-box form

The updated Golf GTI combines linear lamp housings with a thin upper grille, a red
horizontal accent, a large honeycomb lower opening, body-color bumper wings, and
optional X-pattern fog lamps. The Queenstown wheel has five large semicircular
openings. [Volkswagen exterior design](https://www.volkswagen-newsroom.com/en/the-new-golf-gti-and-golf-gti-clubsport-18404/the-sharper-gti-exterior-18406),
[wheel and exhaust description](https://www.volkswagen-newsroom.com/en/press-releases/volkswagen-starts-pre-sales-of-the-new-more-powerful-golf-gti-18394/download).

Modeling direction: short hood and rear overhang, tall cabin, thick rear pillar,
near-vertical hatch, little roof spoiler, and rear wiper. Preserve five-door seams
and a compact rear quarter window. Use a wide lower intake with a patterned insert
set behind a raised surround. The
[official straight-front photograph](https://uploads.vw-mms.de/system/production/images/vwn/080/735/images/1bf0a2b13d1a866903a0ba81a1d75c6e17c1b0a9/DB2023AU01452_web_1600.jpg?1736325883)
is especially useful for grille/lamp/hood alignment. Let five broad wheel openings
and red calipers distinguish it from the sedan's fine spokes. Keep one exhaust on
each side of a restrained lower rear valance.

## 5. SUV: upright utility body

Defender's explicit design cues are short overhangs, upright stance, roof-level
Alpine windows, side-hinged rear door, and external spare. The launch newsroom has
front, rear, side, studio, and accessory photo sets.
[JLR launch and galleries](https://media.jlr.com/defender/en-gb/news/2019/09/introducing-new-land-rover-defender).

Modeling direction: use a nearly horizontal hood, upright fascia, straight roof,
vertical tail, and a taller visible underbody. Arches should have broad, flattened
crowns and contrasting cladding rather than sports-car circular bulges. Add real
wheel-well depth, tire sidewall volume, and coarse tread. Set circular projectors
inside square lamp boxes, with a shallow horizontal grille and skid plate below.
Use chunky five-spoke wheels, four door seams for the 110-inspired version, side
vent, roof rails, spare-wheel mount, and vertically separated rear lamp blocks.
The [JLR design-award article](https://media.jlr.com/corporate/news/2021/04/land-rover-defender-crowned-2021-world-car-design-year)
also provides a clean side-profile photograph of the shorter Defender 90: useful
for surface construction, but do not use its two-door wheelbase for the 110 anchor.

## 6. Classic taxi: narrow, upright three-box sedan

Use Crown Comfort instead of another performance sedan. Toyota explicitly designed
it with a high roof, low beltline, visible corners, spacious rear cabin, and split
bumper sections for repairability. The
[1995 launch article](https://global.toyota/en/detail/7912522) includes the original
[front/side photograph](https://global.toyota/pages/news/older/images/1995/12/19/001.gif)
and a specification table establishing the 2785 mm wheelbase.

Modeling direction: tall thin-pillared greenhouse, horizontal hood/trunk, rectangular
divided lamps, narrow horizontal-slat grille, plain deep bumpers, and modest wheel
diameter. Separate amber corners from pale headlamp reflectors. Add chrome window
and belt moldings, inset rectangular door handles, a clear trunk seam, and simple
hubcaps with radial ribs. A roof taxi sign, yellow livery, and fictional markings
remain game art choices. They should accompany a different shape, not provide its
only difference from the police car. Use slight age in the rubber/trim response,
not exaggerated dirt that obscures the body form.

## 7. Police cruiser: broad muscular fastback sedan

The Charger provides a longer, wider, lower-looking alternative to the taxi's
upright cabin. Stellantis's
[2021 Pursuit announcement](https://blog.stellantisfleet.com/2020/09/dodge-charger-pursuit-dodge-durango-pursuit-updates-for-model-year-2021/)
has a [first-party upfitted photo](https://blog.stellantisfleet.com/wp-content/uploads/2020/09/ChargerDurangoPursuit-iStock-494661628_RETOUCHEDl-NewDurango-BM1-1024x672.jpg)
showing roof lightbars, grille emergency lights, push bars, and pillar spotlights.

Modeling direction: longer hood, broad shoulders, shallow side glass, sloping rear
roof, four doors, and muscular rear quarters. Use narrow, wrapped headlamps and a
wide horizontal grille over a larger lower inlet. Model push-bar uprights and cross
bars with mounting brackets and air gaps. Build the lightbar from a dark housing,
clear outer lenses, and separate red/blue modules—not two glowing roof bricks.
Use black steel-style wheels with small metallic center caps, thicker tires than
the sports sedan, two pillar spots, and roof antennas. A fictional continuous rear
lamp band distinguishes its rear from the taxi's separate rectangular units.

## 8. Cargo van: cab-forward work vehicle

Ford's [Transit Custom gallery](https://www.ford.co.uk/vans-and-pickups/transit-custom/gallery)
contains exterior front/side/rear references. The
[manufacturer front/side photo](https://www.ford.co.uk/content/dam/guxeu/rhd/central/cvs/2023-e-transit-custom/dse/column-cards/ford-e_transit_custom-eu-Column_Card_12_V710_Limited-3x2-1000x667-front-side-view-v710-limited.jpg)
shows the short sloping hood, tall windscreen, horizontal grille slats, swept lamps,
large mirrors on black bases, and stamped recess around the blank cargo panel.

Modeling direction: retain a long, high cargo volume rather than stretching an SUV.
Add front cab doors, a sliding cargo door with a rearward rail, handle recesses,
roof gutters/ribs, blank stamped side panels, and a protective lower rub strip.
At the back add split barn-door seams, hinge blocks, vertical segmented lamps,
plate recess, and a step bumper. Wheels should be smaller relative to body height
and have steel rims/hubcaps, with substantial tire sidewalls. Keep the windshield
inset in a gasket and the A-pillars visibly structural.

## Modeling and review priorities

These are project art recommendations rather than manufacturer specifications:

1. **Silhouette pass:** compare untextured front, side, and rear views at identical
   ground scale. All eight should be identifiable without paint, signage, or lights.
2. **Surface pass:** create continuous hood/fender/door curvature and controlled
   creases. Recess wheel wells, lamp pockets, and grille openings. Avoid overlapping
   disconnected plates masquerading as bodywork or wheels passing through shells.
3. **Construction pass:** use distinct paint, rubber, glazing, lamp reflector,
   plastic, and metal regions. Add panel gaps, window seals, door handles, mirror
   stems, wipers, side markers, and real tire/rim separation. Scale small details
   down until they support rather than dominate the vehicle.
4. **Wheel pass:** give each class its own spoke/hub design, tire aspect ratio, and
   brake visibility. Put discs and calipers behind spokes and keep tread subtle on
   road cars, pronounced only on the SUV.
5. **Lighting pass:** inspect under broad neutral studio lights and in-game sunset
   lighting. The paint needs highlights that reveal curvature; chrome, glass, and
   rubber must not share the same roughness. Avoid excessive emission erasing lamp
   internals and excessive metallic response turning paint into polished metal.
6. **Game pass:** inspect every variant close up from front, side, and rear, then
   together at normal camera distance. Check tires contact ground, reflections do
   not expose broken normals, panel pieces do not flicker, and detail survives the
   optimized GLB export. Automated asset tests complement this visual review.

The exact manufacturer body ratios may need controlled adaptation to the existing
game envelope. Preserve the differences in cabin position, height, overhang balance,
and aperture arrangement even when overall scale is normalized.

## Implemented fleet and licensed source geometry

The studies above establish construction and proportion criteria. The shipped cars
use existing authored geometry rather than claiming to reproduce these manufacturer
models. Accessible CC-BY 4.0 sources yielded eight different body meshes:

- [Generic passenger car pack, Comrade1280](https://sketchfab.com/3d-models/generic-passenger-car-pack-20f9af9b8a404d5cb022ac6fe87f21f5),
  distributed as public FBX/maps by [TUM-VT / Sumonity](https://github.com/TUM-VT/Sumonity-PassengerCars).
  Original creator/license metadata was verified through the public
  [Sketchfab model record](https://api.sketchfab.com/v3/models/20f9af9b8a404d5cb022ac6fe87f21f5).
  Uses: coupe, hatchback, short offroader, sedan taxi, long SUV police, and minivan.
  These provide manufactured panel boundaries, wheel arches, lamps, handles, wipers,
  trim and distinct glass openings. The coupe is deliberately older and lower than
  the M3 study; the police vehicle uses an upright utility body to increase its
  silhouette difference from the taxi. The Defender 90 reference is more relevant
  to the final short two-door offroader than the initial 110 dimensions.
- [Car Concept, Eric Chadwick / Darmstadt Graphics Group](https://github.com/KhronosGroup/glTF-Sample-Assets/blob/main/Models/CarConcept/README.md),
  © 2024 DGG, [CC-BY 4.0](https://github.com/KhronosGroup/glTF-Sample-Assets/blob/main/Models/CarConcept/LICENSE.md).
  Based on a public-domain Unity Fan concept. Used for the GT slot with orange
  paint and a supported rear wing. This is a wide concept silhouette rather than
  a replica of the rear-engine GT3 study. Retains detailed cockpit, brake geometry,
  layered panels, metallic paint normal map, and textured tire tread. Removed logo
  meshes; logos are excluded from the source's content license.
- [SportsCar, Yasutoshi Mori](https://github.com/MirageYM/3DModels), © 2015,
  [CC-BY 4.0 license](https://github.com/MirageYM/3DModels/blob/master/LICENSE).
  Native FBX subdivision geometry used for the hypercar. Its complete projector
  headlight assemblies are also fitted to the Race car, with new mounting cutouts,
  revised proportions and dark perimeter housings. Separate projector optics,
  deep front/side ducts, wheel spokes, discs/calipers, door seams, mirrors, cabin
  and rear diffuser address the detail gaps identified in the references.

Adaptation through Blender MCP includes axis/scale cleanup, new four-wheel pivots,
measured rolling radii, exportable PBR materials, packed textures, isolated front
lamp geometry, taxi/police equipment, and mesh reduction. The six everyday cars
are roughly 6–14k triangles each; the two performance cars remain below 100k each.
This preserves geometry where its silhouette/detail is visible while batching
static surfaces to limit draw calls. It is real-time game artwork, not a scan.
The source FBX/glTF license notices are retained in `assets/blender/licenses`, and
player-facing attribution is available from the lobby's Credits link.
