# PlainMint design contract

The visual source of truth is ../PIC/1.png through ../PIC/4.png, adjusted for the PlainMint name and PRD requirements.

## Layout

- Compact desktop shell with title bar, high-frequency toolbar, per-pane tab bar, editor, and low-emphasis status bar.
- No file tree, project navigation, terminal, cards-as-layout, or IDE chrome.
- Split view is limited to two panes with a minimum pane width of 320 px.
- Search and replace is inline below the toolbar and never opens a separate system dialog.

## Typography and iconography

- UI: system sans-serif (Segoe UI Variable, Segoe UI, system-ui).
- Editor: platform monospace stack, default 14 px and 1.55 line height.
- Icons: Phosphor regular-weight line icons.
- Brand asset: public/plainmint-icon-source.png; generated derivatives live in src-tauri/icons.

## Theme tokens

- Tiffany Aqua #18B7AA is the default accent.
- Graphite #4B5563, Amber #E59A20, Coral #E96F61, and Iris #8B6FD6 are selectable accents.
- Accent colors indicate active controls and editor position only. Error, warning, and success colors remain semantic.
- Dark mode uses deep gray surfaces rather than pure black.

## Accessibility

- All icon buttons have accessible names and tooltips.
- Main workflows are keyboard accessible.
- Focus is never communicated by color alone.
- System reduced-motion and appearance preferences are respected.
- English and Simplified Chinese must keep translation-key parity and remain free of clipped primary actions.
