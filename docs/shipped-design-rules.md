# Shipped 2026 — design rules

Rules extracted from the skill repos Bryton named, plus named interaction patterns from the galleries. The printer on `/` is the product: a real object on a desk, not a marketing page. Every rule below is in force for that page.

Sources cloned and read:

- [emilkowalski/skills](https://github.com/emilkowalski/skills) — `animate`, `apple-design`, `emil-design-eng`, `ask-sonner`
- [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) — `web-design-guidelines` (plus [web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines))
- [expo/skills](https://github.com/expo/skills) — `expo-animation`, `expo-design-system` / `native-slop`
- [twostraws/SwiftUI-Agent-Skill](https://github.com/twostraws/SwiftUI-Agent-Skill) — `design`, `accessibility`
- [Appllama/appllama-skills](https://github.com/Appllama/appllama-skills) — `appllama-app-design-skill`

Galleries studied: [60fps.design](https://60fps.design), [designspells.com](https://designspells.com), [seesaw.website](https://seesaw.website), [webinteractions.gallery](https://webinteractions.gallery), [viewport-ui.design](https://viewport-ui.design), [motion.zajno.com](https://motion.zajno.com), [inspora.design](https://inspora.design), [motionin.design](https://motionin.design), [recent.design](https://recent.design), [posts.design](https://posts.design), [collectui.com](https://collectui.com), [obsidianui.dev](https://obsidianui.dev), [bencho.dev](https://bencho.dev), [vantaui.com](https://vantaui.com), [designbookmark.com](https://designbookmark.com), [cuedesign.space](https://cuedesign.space), [easyui.site](https://easyui.site), [great-ui.com](https://great-ui.com), [paceui.com](https://paceui.com), [dev.cards](https://dev.cards).

---

## A. Skill rules that apply to this page

### Motion (emilkowalski/animate, expo-animation)

1. Animate only `transform` and `opacity` (clip-path is allowed for the paper feed). Never `transition: all`.
2. Never `ease-in` on UI. Entrances use `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`. Sheets use `--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)`.
3. Never `scale(0)`. Appear from `scale(0.94–0.97)` + opacity.
4. Press feedback is 80–150ms, on pointer-down, not click.
5. If a finger was involved, use a spring and hand off velocity. CSS keyframes cannot be grabbed mid-flight.
6. `prefers-reduced-motion` ships with the animation: print is already complete, sheets appear, no looped LED/cursor.
7. Frequency gate: PRINT/TEAR press is tens of times/day → near-imperceptible. The print itself and the tear are occasional → standard. Copied toast is occasional.

### Fluid interfaces (emilkowalski/apple-design)

8. Respond on pointer-down. Continuous 1:1 tracking while dragging the hanging receipt. Interruptible: a new PRINT can tear the hanging slip.
9. Springs from the *presentation* value. Decompose X and Y. Magnetic snap = damping ~0.8 only because the tear carried momentum.
10. Respect grab offset. Pointer capture during drag.

### Design engineering (emil-design-eng)

11. Unseen details: tabular figures, no layout shift, hit slop, haptic on the same frame as the visual.
12. Buttons have `:active` depth. Popovers/sheets scale from their origin; the share sheet is a drawer from the bottom, not a centered modal.

### Toasts (ask-sonner)

13. One toast surface. Copied / opening-checkout are status, `aria-live="polite"`. Enter and exit from the same edge. Loading → success by updating the same surface, not stacking.

### Web Interface Guidelines (Vercel)

14. Icon-only / cryptic keys need `aria-label`. Form LCD input is labelled. Async copy/mail uses `aria-live`.
15. `:focus-visible` rings, never `outline: none` without a replacement.
16. `font-variant-numeric: tabular-nums` on counters, prices, countdown.
17. `touch-action: manipulation`. Safe-area insets on the desk, the share sheet, and sticky ticker.
18. `color-scheme: dark` and `theme-color` match the desk (`#161310`).
19. Time-based and origin-based text render client-side only (no hydration #418).
20. Submit stays enabled until the request starts; then a spinner/busy label.

### Native fidelity / anti-slop (Appllama, Expo native-slop, twostraws/design)

21. Spacing rhythm is 4/8pt. Prefer `gap`. Distinct row / group / section gaps.
22. Touch targets at least 44×44px (Apple HIG / twostraws). Visual keys may be smaller; the hit area may not.
23. Safe areas are part of the design, not patched `margin-top: 50`.
24. Haptics are punctuation: one per user action, same frame as the visual, never on scroll.
25. Tabular numerals for anything that counts, times, or prices.
26. Sheets: grab handle, drag/tear to dismiss, `overscroll-behavior: contain`. Not an X-only dialog.
27. No spinner-blink empty page. Loading is the printer's own LCD, not a centered spinner.
28. Continuous rounded rects on chrome (keys, share sheet). Paper stays torn-rect, not squircle.

---

## B. Gallery patterns implemented on the printer

Named after the shot or effect family, mapped onto this object.

| # | Pattern | Source | What we do |
| --- | --- | --- | --- |
| 1 | Mechanical ticker / counter roll | [60fps.design](https://60fps.design) effect **Ticker** / element **Counter**; Revolut “Number of Transactions” | Odometer strips, tabular figures, reserved height so the count never shifts the printer. |
| 2 | Shimmer while thinking | [60fps.design](https://60fps.design) effect **Shimmer**; [inspora.design](https://inspora.design) / [easyui.site](https://easyui.site) skeleton sweeps | LCD gets a left-to-right phosphor sweep while LOOKING UP / SEARCHING, not a spinner. |
| 3 | Tactile press depth | [60fps.design](https://60fps.design) **Skeuomorphic** + Airbnb “Tactile Tab Button”; Apple Design pointer-down | Keys depress 2px with the shadow collapsing, haptic on `pointerdown`. Hit slop ≥ 44px. |
| 4 | Magnetic snap on tear | [60fps.design](https://60fps.design) **Spring Physics**; [motion.zajno.com](https://motion.zajno.com) magnetic settles | Tear spring overshoots a hair then seats (momentum damping), snap-back if you don't tear. |
| 5 | Bottom-sheet spring | [60fps.design](https://60fps.design) **Bottom Sheet** (Recollect Pro sheet→page); Expo form-sheet | Share sheet rises from `translateY(100%)` with `--ease-drawer`, grab handle, `overscroll-behavior: contain`. |
| 6 | Copied toast | [60fps.design](https://60fps.design) element **Toast**; Emil Kowalski / Sonner | “Copied” status on the sheet, same-frame haptic, auto-dismiss ~2s, `aria-live`. |
| 7 | Ready-state glow on the primary key | [60fps.design](https://60fps.design) Opal “Border Glow” / Revolut coachmark glow | PRINT breathes a warm rim only while READY (not while feeding). |
| 8 | Instant busy morph on $5 | [60fps.design](https://60fps.design) Moods Faster “Pills Morph”; Vercel “spinner during request” | First pointer-down scales the mail button; label becomes OPENING CHECKOUT… before Turnstile returns. |

These eight are the ones that belong on a physical printer. Confetti, 3D camera flips, and mascot intros from the same galleries do not.

---

## C. Audit (violations found → fix)

| Rule | Was | Now |
| --- | --- | --- |
| 22 · 44px targets | Keys 28× ~auto | 44px hit slop; PRINT/TEAR min 44px |
| 21 · 4/8 spacing | 7px / 10px / 1.15rem mix | 8px key gap, 8px stack multiples |
| 16 · tabular nums | Odometer only | Clock + proof countdown too |
| 5 / 4 · sheet motion | `translateY(16px)` fade | Drawer from 100%, `--ease-drawer` |
| 26 · sheet contain | Missing | `overscroll-behavior: contain` |
| 2 · shimmer | LCD cursor only | Phosphor sweep while busy |
| 9 · magnetic tear | Soft settle | Snappier settle with a little overshoot |
| 7 · PRINT glow | Flat cream key | Idle glow when READY |
| 13 · copy toast | Label swap, easy to miss | Visible Copied + haptic |
| 19 · hydration | Time/origin on first paint | Client-only origin, clock, status |
| 18 · status bar | Root `#000` | Shipped `theme-color: #161310` |
| 21 · 4/8 chrome | 13/14px body, rem mix | 8/12/16px on desk, ticker, keys, sheet |
| 22 · LCD / BID 44px | LCD 38px, BID ~30px | LCD, keys, BID, pick, choose all ≥ 44 |
| 1 · glow 60fps | PRINT glow animated `box-shadow` | Opacity on `::after` only |
| 11 · no CLS | Copied toast mounted/unmounted; hanging paper used full ticket height | Reserved toast slot; `paperMax` ~42vh + overflow hidden while feeding |
| 23 · sticky safe-area | Ticker `top: 0` slid under notch | Pin owns `safe-area-inset-top` |
| 15 · LCD focus | `outline: none` on the field | Cream ring on `.shipped-lcd:focus-within` |
| optical | Letter-spacing shoved legends right | Extra left padding on keys |

---

## D. Verify

Phone viewport 390×844. Type, PRINT, full feed, TEAR, share sheet, COPY LINK, $5, sponsors open/close. No console errors. `prefers-reduced-motion` still prints already-torn.
