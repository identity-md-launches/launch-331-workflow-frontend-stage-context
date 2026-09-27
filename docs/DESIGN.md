# Drip — implemented design

## Overview

A one-page Sepolia test faucet, built for people who want to claim a test token or share a balance. Warm off-white backgrounds, dark green text, pale green claim surfaces and a small droplet graphic establish the page's character. Claim and donation stay adjacent on wide screens; the donor list and optional swap follow them. The hero is an introduction, not a separate navigation layer.

Source of truth: `web/src/style.css`, `web/src/App.tsx`, `web/src/main.tsx`, and `web/public/drop.svg`. There is no existing brand guide, external font, icon dependency or raster artwork. These choices were inferred from the task, not separately approved visual requirements.

**Path constraint:** the assignment also requests a root `DESIGN.md`, but its overriding write allowlist permits documentation only under `docs/` or `web/`. This document supplies that record at the permitted `docs/DESIGN.md`; no root file was created.

## Colors

The implemented semantic palette is declared in `web/src/style.css:1` using sRGB hex values. Reuse these roles rather than adding approximate colors.

| Token | Value | Role |
| --- | --- | --- |
| `--page` | `#f5f5ee` | Page background |
| `--surface` | `#fffef9` | Cards, fields, neutral controls |
| `--ink` | `#213c32` | Primary text |
| `--muted` | `#5d6d63` | Descriptions, labels, secondary text |
| `--line` | `#d9dfd2` | Structural separators |
| `--input-line` | `#849486` | Interactive field/button borders |
| `--accent` | `#174b3a` | Primary claim button and brand |
| `--accent-hover` | `#103c2c` | Primary hover |
| `--accent-soft` | `#e5eddc` | Claim card and secondary surfaces |
| `--highlight` | `#d7ef9c` | Featured-token disc and text selection |
| `--error` | `#9b3024` | Error text |
| `--error-bg` | `#fff0e9` | Error/wrong-network surface |
| `--focus` | `#27664d` | Three-pixel keyboard focus outline |

Brand green is also used in the decorative drop, not as an exclusive click cue; links retain underlines and controls retain shapes. Status always includes text. Only the main claim action uses a dark filled button; donation/swap actions remain outlined. No dark theme or unused color ramp is implemented. Disabled primary controls use `#506047` on `#d7e0cd` and a `#a7b79e` border. The full rendered contrast measurements are in `docs/frontend/interaction-results.json`; sampled secondary copy on the pale claim surface measures 4.56:1.

## Typography

Arial, Helvetica, sans-serif is the system stack; no font assets or remote font requests exist. A small decorative caption alone uses Georgia, serif in italics. Body size is 16px, line height 1.5, weight 400. Labels are 14px/600. Secondary UI text uses 13px (`--small`); footnotes use 12px with 1.6 line height. Eyebrows are 11px/700, uppercase via CSS, with 0.1em tracking. These small labels supplement visible headings and controls.

The h1 uses `clamp(2.7rem, 5.5vw, 4.75rem)`, weight 600, 1.02 line height and -0.065em tracking. Card headings use `--heading: 1.6rem`, weight 600 and -0.04em tracking. Smaller section headings have explicitly subordinate sizes. Claim values use 4.2rem/600 with -0.075em tracking; all digits use tabular numbers. Headings balance, body copy uses pretty wrapping, and long content can break anywhere within the shared container. Financial amounts use BigInt formatting; tiny nonzero values show `<0.000001` instead of zero. Exact minimum swap output is displayed without rounding.

Inputs are at least 16px, with the donation field enlarged to 1.7rem. Browser-native system fonts supply their available weights; no claim of loading a custom 600-weight font file is made.

## Layout

`.wrap` caps content at 1104px and leaves 32px on each side on large viewports. At 850px and below it leaves 20px per side. Desktop `.hero` uses a 1.2fr/1fr grid; `.action-grid` uses equal columns with a 20px gap. Standard cards have 30px padding and a 22px radius. The spacing pattern uses 8–12px within groups, 16–24px between related elements and 30–52px between larger sections.

At 850px, cards use 24px padding, the header tightens, and swap fields become two columns. At 660px, the hero and action grid become single-column, decorative water art is hidden, card padding becomes 22px, swap fields stack, and the footer wraps. DOM order stays claim, donation, status, donors, swap, notes. The token selector uses a visibly disclosed native `details` element and an anchored form capped to the viewport width.

Rendered checks covered 1440, 850, 660, 390 and 320 CSS pixels, long token symbols, and 200% CSS text enlargement. These are desktop-browser emulations; native browser zoom, physical phones, RTL and translation are not verified. Shared long-text wrapping and shrinkable flex children prevent overflow without hiding meaningful amounts.

## Elevation & Depth

The design is mostly flat: backgrounds group content, with one-pixel borders for cards, fields and list rows. Only the token-picker panel uses a shadow, `0 12px 32px #213c321a`, because it overlays the page. It has z-index 2. The focusable skip link uses z-index 10. There are no modals, sticky controls or content-obscuring notifications.

## Shapes

Cards use 22px corners, notices and quote panels 12px, the token picker 14px, and buttons/fields 10px. Badges and token discs are rounded pills/circles. The in-source `Drop` SVG and `web/public/drop.svg` provide the repeated droplet. The water illustration uses three CSS ellipse outlines; it is decorative and hidden from assistive technology.

## Components

- `Drop({large})`, in `App.tsx`: decorative brand/icon or hero graphic, inheriting color. Do not assign functional meaning to its artwork.
- `External({href, children})`: underlined external link with a redundant visual arrow, `target="_blank"` and `rel="noreferrer"`.
- Button styles: neutral outlined default, `.primary` for claim, `.quiet` for Refresh/Disconnect, and native `disabled` states. Minimum height is 44px; the primary claim is 52px. Use text beside disabled controls to explain prerequisites.
- Amount-field pattern: a persistent label, decimal-keyboard input, unit suffix, balance and adjacent linked validation message. The input flexes without shrinking a short token suffix into multiple lines. Never replace a label with a placeholder.
- Claim-card pattern: nominal rule, actual possible payout, pool balance, chain-derived eligibility, action, transfer-fee note. It displays loading/unavailable data with an em dash, never an invented balance.
- Donation pattern: amount → exact approval/reset → finality checkbox → separate donation. Native controls preserve keyboard behavior.
- Donor rows: address explorer links and total net donations, five per page, with explicit Previous/Next controls. No backend data.
- Swap disclosure: native details/summary, direction, input, slippage, optional two-step sell permissions, quote and minimum receive. Invalid and expired quotes leave swap disabled.
- Transaction region: persistent status, explorer link, error alert, and Check transaction recovery when a submitted transaction lacks a receipt. Errors stay on screen and never depend solely on color.

Focus uses a three-pixel solid outline with four-pixel offset. Forced colors use system `Highlight`. Motion is limited to 120ms color/background/scale transitions when `prefers-reduced-motion: no-preference`, with a 0.96 press scale. No entry animation, autoplay or essential motion exists. Hover styling applies only on hover-capable devices.

## Do's and Don'ts

Use `.wrap`, existing color roles, native forms, and the current content order for extensions. Keep primary financial data exact, action labels explicit, and secondary copy legible. Add error explanations beside their fields and keep contract prerequisites in both presentation and event handlers. Preserve the shared manifest as the runtime configuration.

Do not add remote fonts, hide overflow to conceal long symbols, replace controls with clickable divs, introduce a second address map, or imply that test-token distributions are fair. Another page would reuse the header, container, card/field patterns and type hierarchy, but would need an explicitly exported static route; this implementation remains one page.

## Attribution

The design/review method follows the assignment's pinned Better Interface guide, adapted from Jakub Krehel, MIT, commit `267330e1adfc66a718fb65fa6918c1f06d0a689e`: [source and license](https://github.com/jakubkrehel/skills/tree/267330e1adfc66a718fb65fa6918c1f06d0a689e/skills/better-interface). The documentation method is adapted from Paul Bakaus's Impeccable, Apache-2.0, commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`: [document reference](https://github.com/pbakaus/impeccable/blob/9d715cc4f5564a990ca8345abfdd5df6dc9b41c8/skill/reference/document.md), [license](https://github.com/pbakaus/impeccable/blob/9d715cc4f5564a990ca8345abfdd5df6dc9b41c8/LICENSE), [notice](https://github.com/pbakaus/impeccable/blob/9d715cc4f5564a990ca8345abfdd5df6dc9b41c8/NOTICE). Their licenses apply to their respective works; no relicensing of either work is asserted. The pinned guide itself is not redistributed here.
