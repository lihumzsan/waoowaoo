# Incoming Last-Frame Video Controls Design

## Problem

When a panel is used as the final frame of the preceding panel's first/last-frame video, the video card treats that incoming relationship as an exclusion. Its normal prompt, duration controls, model picker, generation action, and normal-video preview are hidden.

For example, if panel 15 is the last frame of panel 14, panel 14 owns the 14-to-15 transition video. Panel 15 still owns an independent video that starts from panel 15. Hiding panel 15's controls makes that second output inaccessible even though no data has been removed.

## Decision

Treat incoming and outgoing first/last-frame relationships independently.

- An incoming relationship is informational: show a non-editable badge stating that the panel is the last frame for the preceding panel.
- An outgoing relationship changes the panel's generation mode: show the panel-to-next-panel first/last-frame prompt, configuration, and action.
- With no outgoing relationship, always show the panel's own normal-video prompt, duration controls, model configuration, generation action, and generated-video preview, even when an incoming relationship exists.

This produces the following state matrix:

| Incoming relation | Outgoing relation | Controls and preview owned by the current panel |
| --- | --- | --- |
| No | No | Normal video |
| Yes | No | Normal video |
| No | Yes | First/last-frame video to the next panel |
| Yes | Yes | First/last-frame video to the next panel, plus both relationship badges |

The preceding transition is not duplicated on the target panel. It remains the video output of its source panel.

## Implementation Boundaries

- Keep first/last-frame prompt and generation state keyed to the source panel, as it is today.
- Update card-body visibility so incoming-last-frame status does not suppress the normal controls.
- Update normal-video preview and header regeneration visibility so an incoming-only panel can display and regenerate its own normal output.
- Do not change persistence schemas, generation API payloads, or first/last-frame workflow routing.

## Verification

- Add a rendered-card regression test for an incoming-only panel that asserts normal prompt and generation controls remain present.
- Add runtime/header coverage confirming a normal video remains visible and regenerable when the panel is an incoming last frame.
- Preserve existing coverage for outgoing and first/last-frame regeneration states.
