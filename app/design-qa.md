# PlainMint Design QA

Final result: **PASSED**

## Source of truth

- Product requirements: `../PlainMint_PRD.md`
- Visual references: `../PIC/1.png` through `../PIC/4.png`
- Design contract: `DESIGN.md`
- Implementation: `src/`, `src-tauri/`

## Compared states

- Viewport: 1586 × 992
- Editor reference vs implementation: `qa/editor-comparison.png`
- Settings reference vs implementation: `qa/settings-comparison.png`
- Implementation captures: `qa/editor-1586x992.png`, `qa/settings-1586x992.png`
- Focused-region crops were not required: the source states are full-window desktop views, and text, toolbar, tabs, modal edges, and status bars remain legible in the combined full-window comparisons.

## Visual review

- Shell geometry, mint canvas, white editor surface, title bar, toolbar, tab treatment, active-line highlight, status bar, modal dimming, controls, borders, and radii follow the supplied direction.
- LitePad naming and artwork were replaced with PlainMint branding and the generated production icon.
- The implementation intentionally uses the PRD's 14 px default editor font, which is denser than the presentation-sized reference image. Users can change font size in Settings.
- Settings were reorganized into seven focused sections so all PRD controls remain discoverable without overcrowding the General view.
- Chinese and English layouts were checked for wrapping, clipping, hierarchy, and action visibility. No horizontal overflow or cropped controls were found.

## Interaction review

- New, open, save, Save As, tab selection/close, unsaved confirmation, undo/redo, wrap, split, settings, theme, language, and recovery actions are wired.
- Split preserves the selected left document and opens the expected independent right editor view.
- Find and replace opens inline, reports matches, supports previous/next, case sensitivity, whole word, replace, and replace all.
- Session snapshots, recent files, recovery copies, external-change detection, read-only handling, safe writes, and encoding/line-ending preservation are implemented in native mode.
- Closing the native window with dirty files presents a batch save/discard decision.

## Verification history

1. Initial visual pass found session hydration overriding explicit preview states and a split-selection mismatch. Preview-state isolation and split-state preservation were implemented.
2. Native release smoke test found updater initialization missing configuration. A safe unsigned-build placeholder was added; signed release configuration still injects the real public key.
3. Final browser checks passed for editor, split, find/replace, Settings General, and live Simplified Chinese ↔ English switching.
4. Final native executable remained running and responsive; Windows NSIS packaging completed successfully.

## Automated checks

- `npm run check`: passed
- `npm run build`: passed
- `cargo test --manifest-path src-tauri/Cargo.toml`: passed
- `npm run tauri:build -- --bundles nsis`: passed
- Native release smoke test: passed

## Known release boundary

- The generated local installer is unsigned. Formal Windows/macOS signing and updater publication require project credentials in GitHub Actions.
- macOS DMG configuration is included and covered by CI, but this Windows workstation did not execute a local macOS bundle.
