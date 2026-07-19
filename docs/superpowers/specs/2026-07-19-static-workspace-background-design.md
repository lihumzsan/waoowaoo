# Static Workspace Background Design

## Goal

Keep the novel-promotion workspace's current soft blue-gray glass aesthetic while removing the full-screen motion that makes the page appear to flicker.

## Scope

- Replace the animated aurora/blob layers used by `AnimatedBackground` with a static CSS gradient.
- Preserve the fixed, behind-content placement and the existing canvas color tokens.
- Remove only the aurora/blob keyframes and helper classes that become unused.
- Do not change workspace data flow, task handling, navigation, cards, buttons, or page-transition animations.
- Do not add a bitmap asset or a network request.

## Component Design

Rename `AnimatedBackground` to `WorkspaceBackground` so the component name describes its responsibility without implying motion. Render one fixed, pointer-events-disabled background layer composed of the canvas color plus two subtle radial gradients. The gradients use existing glass theme variables and remain static at every viewport size.

`NovelPromotionWorkspace` continues to mount the background in the same location. No state, props, effects, or error handling are needed because the component is purely presentational.

## Performance

The replacement must not use animation, an oversized 200% layer, `blur(100px)`, or `backdrop-blur`. This removes continuous full-viewport opacity, transform, blur, and compositing work.

## Verification

- Add a focused unit/contract test that proves the workspace background contains no aurora/blob animation classes and uses a static gradient.
- Confirm the old aurora/blob CSS definitions have no remaining references before removing them.
- Run the focused test and TypeScript typecheck.
- Verify the live project workspace visually and confirm no computed `aurora` or `blob` animation remains.
- Confirm the video-tools page and other unrelated interactions are unchanged.
