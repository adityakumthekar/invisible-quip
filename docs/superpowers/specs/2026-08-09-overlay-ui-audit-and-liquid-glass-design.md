# Quip Overlay — UI/UX Audit and Liquid-Glass Material Design

**Date:** 2026-08-09
**Scope:** the live overlay surface — `src/index.css`, `src/components/shell/*`, `src/components/teaching/*`, `src/_pages/Queue.tsx`, `src/App.tsx`, `tailwind.config.js`.
**Overall score: 43/100.**

---

## 1. What prompted this

A screenshot of the running overlay sitting over a bright Amazon search page. Three problems, in the user's order of priority:

1. The drop shadows read as muddy dark halos around every panel.
2. The material doesn't read as glass — it's a flat translucent scrim with no lens cues.
3. The design system is half-built: good colour tokens, no type or radius discipline, and several functional gaps in the chat panel.

## 2. The governing constraint

`backdrop-filter` **cannot blur the desktop** behind Quip's window. The overlay is a `transparent: true` frameless `BrowserWindow` (`electron/mainWindowPolicy.ts`), and on such a window `backdrop-filter` only blurs content inside the page (electron#30412, electron#30077). This is already documented at the top of `src/index.css`. The `--glass-blur` token is therefore decorative.

Everything below follows from that: **legibility and the glass read must be bought with contrast and light modelling, never with blur.**

---

## 3. Scorecard

| # | Area | Score | Summary |
|---|------|-------|---------|
| 1 | Design tokens & consistency | 4/10 | Colour tokens excellent; radius tokens declared then bypassed; dead rules |
| 2 | Typography | 4/10 | 7 sizes inside a 3px range, no scale |
| 3 | Depth & material | 5/10 | 4 shadow layers taxing a content-sized window; no lens cues |
| 4 | Information architecture | 5/10 | Safety setting filed under Provider; two conflicting spatial models |
| 5 | Control bar | 5/10 | 10 controls, arbitrary label rules, destructive action unguarded |
| 6 | Chat panel (core loop) | 6/10 | Four gaps that bite specifically in a long live session |
| 7 | Feedback & states | 4/10 | Success and failure render identically |
| 8 | Accessibility | 5/10 | Partial ARIA, two tab patterns, no reduced-transparency |
| 9 | Motion | 3/10 | Enter only; toast animation classes are inert |
| 10 | Legacy surfaces | 2/10 | Reachable pages that ignore the design system entirely |

---

### 3.1 Design tokens & consistency — 4/10

**What's good, and it's genuinely good.** The colour token layer is well designed and fully adopted. All 12 live overlay components contain **zero** raw `text-white/xx`, `bg-white/xx`, `border-white/xx` or `bg-black/xx`. Tokens are surfaced through `tailwind.config.js` as `colors.glass.*` so components write `bg-glass-hover` rather than `bg-white/10`. Each `[data-glass-strength]` level self-corrects — as the fill thins, the text tiers, halo and reading scrim step up together. That is a real system.

**What's broken.**

- **Radius tokens are declared and then ignored.** `--glass-radius: 18px` and `--glass-radius-sm: 12px` exist in `:root` (`src/index.css:45-46`) and are used only by the surface rules themselves. Components use Tailwind's defaults instead: `rounded-lg` (8px) ×38 and `rounded-md` (6px) ×10. So an 8px control sits inside an 18px panel — non-concentric, and visibly so at the corners.
- **Dead CSS.** `.liquid-glass`, `.liquid-glass.chat-container`, `.liquid-glass-bar`, `.liquid-glass-dark` (`src/index.css:683-701`) and `.glass-content` (`:703`) have **0** usages in any `.tsx`. Labelled "legacy aliases so older class names still render quietly" — the older class names are gone.
- **`--glass-success` is declared (`:38`) and never referenced** anywhere. Success has no visual language.

**Special case — do not "clean up" these two.** `.glass-panel-light` and `.glass-panel-secondary` also have 0 `.tsx` usages, but they are load-bearing: they appear in *both* the `pointer-events: auto` rule in `index.css:152-163` **and** `HIT_SELECTOR` in `src/hooks/useClickThrough.ts:4-5`, and `src/lib/clickThroughSelectors.test.ts` asserts the two lists stay in sync. They are cheap to keep and expensive to get wrong.

### 3.2 Typography — 4/10

Seven distinct sizes across ~1,500 lines of overlay UI:

| Size | Usages |
|---|---|
| `text-[11px]` | 64 |
| `text-[12px]` | 13 |
| `text-xs` (12px) | 8 |
| `text-[13px]` | 7 |
| `text-[11.5px]` | 7 |
| `text-[12.5px]` | 6 |
| `text-sm` (14px) | 3 |
| `10px` (`.kbd`) | 1 rule |

`text-[12px]` and `text-xs` are the same size expressed two ways. `text-[11px]`/`text-[11.5px]` and `text-[12px]`/`text-[12.5px]` are 0.5px apart — differences no reader can perceive, but which guarantee no two components agree. There is no scale; each size was picked at the call site.

### 3.3 Depth & material — 5/10

**The shadow tax.** Every surface stacks four `box-shadow` layers:

```css
/* .glass-panel-dark, src/index.css:406-410 */
box-shadow:
  0 0 0 1px rgba(0, 0, 0, 0.35),      /* contact ring   — reach 1px  */
  inset 0 1px 0 rgba(255,255,255,.07),/* inner hairline — reach 0    */
  0 2px 6px rgba(0, 0, 0, 0.26),      /* near shadow    — reach 5px  */
  0 10px 28px rgba(0, 0, 0, 0.48);    /* far shadow     — reach 24px */
```

On a window **sized to its own content** that 24px reach is not free. Box-shadows don't contribute to layout, so anything reaching past the wrapper padding is hard-clipped at the transparent window edge. The codebase compensates in three places:

- `src/_pages/Queue.tsx:797` — `pb-8` (32px) of wrapper padding, with a comment explaining it exists for the shadows.
- `src/components/shell/ShortcutsTooltip.tsx:25` — `offsetHeight + 26`, hand-reported slack.
- `src/App.tsx` — `CHROME_PX = 150`, whose comment names "the pb-8 shadow guard" as a component.

**Net: the overlay is ~28px taller than its content, to make room for a decoration the user does not want.**

**No lens cues.** The surfaces are uniform flat fills. Apple's Settings material reads as glass because of four things: backdrop blur (unavailable to us), a *specular rim* that is bright along the top edge and fades toward the bottom, a top-lit luminance falloff inside the surface, and a faint bottom bounce-light. Three of those four are pure CSS and cost nothing here. None are present.

### 3.4 Information architecture — 5/10

- **A safety control is filed under hardware config.** `SettingsPanel.tsx:455-487` puts "Autopilot approval" — Guarded / Balanced / Hands-off, the setting that decides whether Quip will act inside a terminal without asking — at the bottom of the **Provider** tab, below the vLLM base URL and API key fields. It is not provider configuration.
- **Five icon-only tabs, no label anywhere.** `TABS` (`:78-84`) carries a `label` for each of Modes / Provider / Appearance / Keybinds / About, but the tab strip renders only `<Icon>` (`:261`). The label reaches the user solely through the native `title` tooltip. Nothing shows which tab is open in words.
- **Two spatial models, no rule.** `QuickActions` (300px) and `SettingsPanel` (336px) render inside the same `flex items-start gap-2` row as the ControlBar (`Queue.tsx:808-851`), so opening them grows the overlay *sideways* across the desktop. `TeachingPanel` (440px) and the chat panel (560/880px) stack *below*. Same kind of object, two behaviours.

### 3.5 Control bar — 5/10

Ten controls in one row with a single divider (`ControlBar.tsx:220`).

- **Labelling is arbitrary.** Ask AI, Teach Me, Show/Hide and Record carry text; New chat, Quick actions, Settings, Collapse and Quit are icon-only. Two of the icon-only ones carry an explanatory comment about why ("the window is sized to this bar, so a text label would widen the overlay") — which is true of every button, so it isn't the rule.
- **Quit sits directly beside Collapse** (`:264-283`), with no separator and no confirmation. `Collapse` even has a `disabled` guard for in-flight runs; `Quit` has none, and it is the more destructive of the two.
- **Keyboard hints widen the overlay permanently.** The `.kbd` chips are inline in the buttons, and the bar sets the overlay's minimum width. This is a real cost, but a defensible one — it's the app's main discoverability mechanism, and it stays.

### 3.6 Chat panel — 6/10

The best-built surface in the app, with four gaps that all bite hardest in exactly the scenario Quip exists for: a 45-minute live session.

- **You cannot see which model is answering.** `src/components/shell/AIResponse.tsx:227` renders `modelLabel` only when `!hasContent` — so it is visible on an empty panel and disappears the moment a conversation starts. With the Gemini ↔ remote-Qwen toggle now live, mid-session you have no way to tell which one you're talking to.
- **Auto-scroll fights the reader.** `:191-195` sets `scrollTop = scrollHeight` on every change to `messages` or `loading`, unconditionally. Scroll up to re-read something from minute 12 and the next stream chunk yanks you back to the bottom.
- **No stop-generating.** The only way to halt a bad answer is ⌘N, which calls `chatAbortRef.current?.abort()` *and* clears the transcript (`Queue.tsx:246-257`). Stopping costs you the whole conversation. The `AbortController` needed for a non-destructive stop already exists.
- **You cannot type ahead.** `:349` disables the input while `loading`, so the seconds spent streaming an answer can't be spent composing the follow-up.

### 3.7 Feedback & states — 4/10

- **Success and failure look identical.** `SettingsPanel.tsx:308-316` renders "Working…", "Ready" and the raw `errorMessage` through the same `glass-subtle` class, truncated to `max-w-[150px]`. A connection failure and a connection success differ only in the words, and the words are cut off.
- **`ToastClose` is written, exported, and never mounted.** Defined at `src/components/ui/toast.tsx:75-90`, exported at `:122`, rendered nowhere. A toast can only time out.
- **Contradictory toast positioning.** `Toast` is `fixed top-4 left-4` (`:51`); its `ToastViewport` is `fixed bottom-0 right-0` (`:21`). On a content-sized transparent window, `fixed` resolves against the window — so the toast lands on top of the control bar.

### 3.8 Accessibility — 5/10

- Across ~30 interactive controls: 12 `aria-label`, 7 `aria-pressed`, 3 `aria-live`, 2 `aria-expanded`, 1 `aria-selected`, 1 `aria-labelledby`, 1 `aria-busy`. Coverage is real but partial and inconsistently applied — `Ask AI` toggles a panel with no `aria-pressed`; Quick actions and Settings likewise.
- **Two tab patterns for one job.** `TeachingPanel.tsx:122-144` uses `role="tablist"` / `role="tab"` / `aria-selected` but declares no `aria-controls` and has no element with `role="tabpanel"`. `SettingsPanel.tsx:246-264` implements the same control as plain buttons with `aria-pressed`. Neither is complete.
- Icon-only settings tabs have `title` but no `aria-label`.
- **No `prefers-reduced-transparency` support.** Electron 33 ships Chromium 130; the media query landed in Chromium 118. A user who has switched on macOS *Reduce Transparency* — an accessibility setting that exists precisely for people who struggle to read text over busy backgrounds — gets the identical see-through overlay. This is the most consequential a11y gap, because it's the one the app's own core constraint makes worst.

### 3.9 Motion — 3/10

- One animation, `panel-reveal`, 0.28s, on enter only (`index.css:581-594`). Panels appear smoothly and vanish instantly.
- **The toast's animation classes are inert.** `toast.tsx:53` applies `animate-in fade-in slide-in-from-bottom`. `fade-in` and `slide-in-from-bottom` come from `tailwindcss-animate`, which is **not installed** — `plugins: []` in `tailwind.config.js`, and the package is absent from both `package.json` and `node_modules`. `animate-in` happens to work by coincidence, because `theme.extend.animation.in` generates an `animate-in` utility. The other two emit nothing.

### 3.10 Legacy surfaces — 2/10

`src/_pages/Solutions.tsx` (469 lines), `src/_pages/Debug.tsx` (354 lines) and `src/components/Queue/ScreenshotItem.tsx` are reachable — ⌘H to screenshot, then **Solve**, and `onSolutionStart` switches the view. They carry 19 raw `text-white/xx` / `bg-black/xx` colour usages and essentially no glass tokens. Once you reach them you are looking at a visually different application.

**Out of scope for this pass.** 823 lines of template-era code, no test coverage, and a screenshot-queue flow that is secondary to the chat path. Fixing it properly means deciding whether it should exist at all — a separate question.

---

## 4. The material design

### 4.1 Approaches considered

| Approach | Real blur? | Verdict |
|---|---|---|
| **CSS faux-lens** | No | **Chosen.** Models the light instead of the blur. Zero risk to stealth, click-through, or window auto-sizing. |
| Native macOS `vibrancy` | Yes | Rejected. Vibrancy paints the entire window rect, so the transparent gaps between the floating pill and the panels fill in — the overlay stops being floating cards and becomes one contiguous slab. Would require redesigning the layout around a single container and toggling vibrancy off for the collapsed blob. |
| Captured-backdrop blur | Yes | Rejected. Main grabs the desktop behind the window via `desktopCapturer`, downsamples, and the renderer blurs it as a background image. Keeps the floating look and gives true blur — but requires *continuous screen capture*, which costs battery and cuts directly against the app's stealth premise, and tears whenever the window or the desktop moves. |

### 4.2 The chosen material

Three layers, none of which is a drop shadow.

**a. Top-lit gloss** — light entering the top edge:

```css
background:
  linear-gradient(180deg,
    rgba(255,255,255,0.16) 0,
    rgba(255,255,255,0.06) 4px,
    rgba(255,255,255,0.00) 10px),
  rgb(var(--glass-primary-rgb) / var(--glass-primary-alpha));
```

The token fill stays the bottom layer, so the three themes and all three `[data-glass-strength]` levels keep working untouched.

**The stops are in pixels, not percentages, and that is load-bearing** — see §4.4.

**b. Specular rim** — a *gradient* hairline, bright along the top, near-nothing through the middle, with a faint bounce-light return at the bottom. Painted with a masked pseudo-element so it stays a true 1px line around every corner radius. This asymmetry is the single strongest "this is a lens" cue, and it's what a flat `border` can never give you.

**c. Contact ring** — `box-shadow: 0 0 0 1px rgba(0,0,0,0.34)`. Zero offset, zero blur: it is edge definition against a bright desktop, not depth. Reach drops from 24px to 1px.

Text shadows (`--glass-text-shadow`, `--glass-text-shadow-strong`) are **untouched**. They are the WCAG 4.5:1 mechanism over an unblurred desktop, not decoration.

### 4.3 What this buys back

| Site | Before | After |
|---|---|---|
| `Queue.tsx` wrapper padding | `pb-8` (32px) | `pb-1` (4px) |
| `ShortcutsTooltip` reported height | `offsetHeight + 26` | `offsetHeight + 4` |
| `App.tsx` chat height budget | `CHROME_PX = 150` | `CHROME_PX = 122` |

The overlay window gets ~28px shorter and the chat scroller gets 28px more room.

### 4.4 The measurement, and what it caught

The predicted risk was real and the first implementation tripped it.

A gloss gradient adds white to the top of the panel, which *raises* the background luminance exactly where light text sits. The obvious first cut — `0.10` white fading out by 55% of the panel height — sits **behind the text**, and measured:

| | subtle tier, white desktop, running text |
|---|---|
| Before the change | **4.94:1** |
| Percentage-wash gloss | **4.24:1** — through the floor |
| Pixel-band gloss (shipped) | **4.94:1** — unchanged |

The fix is to make the gloss a **10px band** rather than a wash. It is fully transparent before any text starts — the tightest case is `.icon-btn` in the control bar at ~11.6px, and panel headers start at 14px — so it contributes exactly zero at every text position. It is also closer to the reference: Apple's specular highlight is a concentrated band under the edge, not a broad wash. **Keep the final stop at or under 10px.**

Verified numerically by compositing desktop → fill → scrim → gloss → text and computing WCAG contrast. The model reproduces this file's own previously published figures exactly (clear 4.94, balanced 4.94, solid 6.96 vs. a documented 6.86), which is what makes the comparison trustworthy.

**A separate, pre-existing finding this exposed.** The published floor of 4.94:1 describes the *body* region — running text sitting on `.glass-reading`'s scrim. Panel **chrome** has no scrim, and there the low tiers were never measured. They do not clear 4.5:1:

| Region | heading | text | muted | subtle |
|---|---|---|---|---|
| body (scrimmed) | 8.14 | 7.28 | 5.77 | **4.94** |
| header (no scrim) | 5.19 | 4.70 | 3.81 | **3.36** |

*(clear strength, white desktop — the worst case.)*

This predates the change and is unchanged by it. But this pass made one such element permanent — the model label in the chat header, previously hidden as soon as a conversation started (§3.6) — so that one is fixed directly: it now carries a `.glass-badge` chip using the same `rgba(0,0,0,0.28)` backing the key caps already use, which takes it from 3.36:1 to **5.01:1** at every strength.

The general gap — `muted` and `subtle` text anywhere in unscrimmed panel chrome — is listed as open in §5. Note that the real-world figures are better than the table, because none of this models the per-glyph `--glass-text-shadow-strong` halo, which is precisely the mechanism this file uses to buy contrast for the low tiers. The repo's own published methodology doesn't model it either, so the numbers are consistent with each other.

---

## 5. Ranked fix list

**Now (this pass)**

1. Remove the drop-shadow layers; adopt the faux-lens material; reclaim the 28px of slack. *(§3.3, §4)*
2. Always show the active model in the chat header. *(§3.6)*
3. Scroll-lock the transcript; only auto-scroll when already pinned to the bottom. *(§3.6)*
4. Non-destructive stop-generating. *(§3.6)*
5. Add `prefers-reduced-transparency`. *(§3.8)*
6. Move Autopilot approval out of the Provider tab. *(§3.4)*
7. Type and radius scales as tokens, then migrate call sites. *(§3.1, §3.2)*
8. One spatial model — stack the side panels below the bar. *(§3.4)*
9. Real toast keyframes; render `ToastClose`; fix toast positioning. *(§3.7, §3.9)*
10. Colour the settings status by outcome. *(§3.7)*
11. Unify the tab pattern on `role="tab"` + `aria-controls`. *(§3.8)*
12. Separate Quit from Collapse; consistent bar labelling. *(§3.5)*
13. Delete the dead `.liquid-glass*` / `.glass-content` rules. *(§3.1)*
14. Allow typing ahead while streaming. *(§3.6)*
15. Two-step confirm on Quit — it sat flush against Collapse, in a bar you drag by its edge, with no confirmation and no undo. *(§3.5)*

**Open**

- **`muted` / `subtle` text in unscrimmed panel chrome measures 3.36–3.81:1** (§4.4). Found while verifying this change; predates it. Fixing it generally means either raising the low-tier alphas — which flattens the type hierarchy everywhere — or extending a scrim into panel headers, which changes the design. Both are decisions, not clean-ups. The one element this pass made permanent is already fixed with `.glass-badge`, and the same chip is the cheap remedy anywhere else it matters.
- **Panel exit animation.** Deliberately not attempted. Panels are conditionally rendered, so an exit needs delayed unmount — and `stopTeaching` resets the session state at the same moment it closes the panel, so keeping it mounted for 180ms would flash reset content on the way out. Low value, real regression risk, and unverifiable by screenshot (§6). The toast's exit — which was genuinely broken, not merely absent — *is* fixed.

**Not now**

- **Legacy `Solutions.tsx` / `Debug.tsx` / `ScreenshotItem.tsx`** (§3.10) — needs a decision about whether the screenshot-queue flow survives, not a restyle.
- **Continuous ("squircle") corners** — Apple's corners are superelliptical. CSS `corner-shape: squircle` is Chrome 139+; Electron 33 is Chromium 130. An SVG mask would fake it but breaks the rim and ring rendering. Circular radii for now.
- **Adaptive tint** — Apple's glass shifts light-on-dark vs dark-on-light by sampling what's behind it. Sampling the desktop means continuous capture, which is the same objection that ruled out captured-backdrop blur.

---

## 6. Verification

- `npm test` — 39 files / 398 tests green at baseline. `src/lib/clickThroughSelectors.test.ts` is the critical one: it re-reads `index.css` and `useClickThrough.ts` from disk and fails if the CSS surgery desyncs the two hit lists. A click-through regression is otherwise silent — the surface renders correctly and just stops receiving clicks.
- `npx tsc --noEmit` and `npx tsc -p electron/tsconfig.json --noEmit`.
- Numeric contrast check per §4.4.
- Manual, at the machine (`npm run app:dev`), over both a white and a dark desktop. Note the standing constraint: the overlay cannot be screenshotted in its default `INVISIBLE=true` state, and `INVISIBLE=false` deliberately fails the privacy preflight — so this step is human-only.
