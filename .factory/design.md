# Visual thesis — the routing room in risograph

## Direction and rationale

Service Notification Router should feel like the dependable wall board in a tiny
front office: tactile, legible and obviously operational. The visual direction is
**risograph tactile collage**—misregistered spot inks, clipped appointment slips,
rubber-stamp states and routing strings. It makes the otherwise invisible act of
sorting a booking understandable without pretending this is a large automation
suite. This is intentionally a single, paper-light treatment; a dark theme would
erase the ink-on-stock metaphor and reduce recognition of operational states.

## Palette

All color is encoded as CSS tokens and checked against the paper background.

| Token | Value | Use |
| --- | --- | --- |
| paper | `#F5EBD8` | explicit page background |
| paper-raised | `#FFF9ED` | inputs and working sheets |
| ink | `#172033` | primary text and outlines |
| ink-muted | `#5C554B` | secondary text (≥ 4.5:1 on paper) |
| cobalt | `#2457A7` | links, selected route, focus |
| vermilion | `#B83A25` | primary actions and urgent states |
| sunflower | `#E2B93F` | warning/attention blocks with ink text |
| leaf | `#286448` | successful delivery/acknowledgment |
| danger | `#9F2F2B` | failures, paired with a label/icon |

Inks are flat spot colors. Small 6% dot textures and 2 px misregistered shadows
add physical depth; no gradients are used.

## Typography and spacing

- Display: Georgia, Cambria, `Times New Roman`, serif. Its editorial weight makes
  route names read like labels pulled from a job jacket.
- UI/body: Arial, Helvetica, sans-serif. It is self-hosted by the operating system,
  fast, familiar and crisp at small operational sizes.
- Scale: 14, 16, 18, 22, 32 and clamp(40–72) px; body is never below 16 px.
- Measure: 68 characters for prose, 42 for setup instructions.
- Spacing follows a 4/8 px rhythm: 4, 8, 12, 16, 24, 32, 48, 72.
- Controls have a minimum 44 px target; major actions are deliberately blocky.

## Composition and interaction grammar

The public/setup screen uses an asymmetric two-column broadside: one concise
promise next to an original collage of appointment slips moving to three service
trays. The console becomes a working routing board: a narrow navigation rail, a
metrics strip, then an unboxed list of recent notices. Independent rules are
paper tickets with clipped corners rather than generic rounded cards.

Buttons depress by 2 px and lose their offset shadow. New deliveries enter once
from the origin at 180 ms; state changes use a 220 ms stamp-in scale/opacity.
Nothing loops. With `prefers-reduced-motion`, transforms and scrolling behavior
are removed and state changes are immediate.

## Responsive intent

At 390 px, the navigation becomes a horizontally scrollable labeled strip, metrics
stack two-up, and dense event rows become definition lists. The decorative route
string and secondary illustration texture are dropped; setup and routing remain
fully usable. Forms are one column and the primary action spans the available
width.

## Original asset plan and provenance

### `hero-routing-room`

- Use case: `stylized-concept`; landing/setup hero illustration.
- Subject: a top-down paper collage of one appointment slip being sorted along a
  cobalt cord into three labeled-by-symbol coordinator pigeonholes (tooth, flower,
  scissors), with a small acknowledgment stamp returning along the route.
- World/materials: torn cream stock, fibrous recycled paper, cotton string,
  binder clips, ink stamps, rough halftone edges.
- Light/lens: flatbed-scanner overhead, soft ambient shadows, editorial framing,
  generous quiet paper around the composition.
- Palette words: warm parchment, deep navy, cobalt, vermilion, sunflower, leaf.
- Negative list: no text, no letters, no logos, no watermark, no real people, no
  screens, no generic SaaS dashboard, no gradients, no photorealistic brands.
- Final prompt: “Use case: stylized-concept. Asset type: landing page hero.
  Primary request: top-down tactile risograph paper collage explaining one booking
  being routed privately to the correct one of three service coordinators. Scene:
  torn appointment slip at left follows a cobalt cotton cord to three distinct
  pigeonhole trays at right, identified only by simple tooth, flower, and scissors
  cut-paper symbols; only one tray receives the slip; a small green round
  acknowledgment stamp travels back along the cord. Style: handmade editorial
  risograph, visibly fibrous recycled cream paper, rough halftone ink, slightly
  misregistered deep navy, cobalt blue, vermilion red, sunflower yellow and leaf
  green spot colors, binder clips, flatbed-scanner overhead view, soft physical
  shadows, wide landscape composition. No text, no letters, no numbers, no logos,
  no watermark, no people, no screens, no gradients, no glossy 3D.”
- Generator: Azure AI Foundry via `/opt/fleet/lib/gen-image.sh`, deployment
  `factory-image`, generated 2026-08-27. Original work for this product; no source
  imagery or third-party marks.

Icons in the application are authored inline as simple geometric SVG paths and
are treated as interface symbols, not illustrative assets.
