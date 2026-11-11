# Nou Scripts design brief (v2, after 10 review rounds)

Target: Enterprise SaaS, premium. Think Linear, Vercel, Stripe Dashboard, Height: calm, dense, exact.

Who and why: Dave, the producer of NouGen News, decides here whether a script is ready to voice. The screen
must make that decision fast: what the script says, how long it runs, what changed, and whether it is approved.

Layout (fixed by Dave, do not change): three bands.
- Top: menu bar (title, versions, view modes, toggles) and a telemetry strip.
- Middle: left rail (stories), main (script), right rail (approval, notes).
- Bottom: three modules; the middle one is the input with + for attachments and a Digest button.

Rules:
1. One accent colour, used only for the primary action and the current selection. Gold = approve. Violet = Nou.
2. Hierarchy by weight and size, not by boxes. Fewer borders; use spacing and subtle surface steps.
3. 4 px spacing grid. Consistent radii (6 / 10). Hairline 1 px dividers at low contrast.
4. Type: system UI for chrome at 12-13 px; the spoken script in a reading face at 16-18 px, line-height 1.55.
5. Numbers are tabular. Time codes are monospace.
6. Every control has a clear hover and focus state. Nothing is clipped, nothing wraps awkwardly at 1280 x 860.
7. Dark theme, near-black neutral surfaces (no purple tint in greys). Contrast meets WCAG AA for body text.
8. No decoration that carries no information.
9. All neutral surfaces are true greys (no violet or cold tint); colour is reserved for state: gold = approve/selection, violet = Nou.
10. Two radii only: 10 px for surfaces, 6 px for controls. No pills.
11. Accent budget: at most one gold-filled button on screen (Approve). Send, Digest and secondary actions are neutral with a coloured hover.
12. Accent borders and fills appear only on focus, selection or a real state; resting containers are neutral.
13. Status is coloured text (gold = needs review, green = approved), never a boxed pill.
14. Secondary triggers (Digest, Send, Export, toggles) rest border-neutral and surface-neutral; colour arrives on hover or activation.
15. Cards are separated by surface steps, not outlines; an outline appears only on hover or focus.
16. Segment, change and lint tags are plain coloured uppercase text (10 px, tracked), never boxes.
17. Radii come only from tokens: --radius-surface (10 px) and --radius-control (6 px).
18. Every scrolling column ends with at least 24 px of bottom padding; controls in a row share one vertical centre.
19. Text inputs in a control row use a line box that matches the 38 px control height, so text and buttons share a centre line.
20. Rail lists indent 16 px with at least 6 px between items; a selected segment reads at full text contrast.
21. Segmented controls keep a uniform 3 px inner track inset; buttons never touch the track edge.
22. Nothing may widen the window: every band is pinned to the viewport and long titles truncate with an ellipsis. Check with a DOM overflow scan, not only by eye.
