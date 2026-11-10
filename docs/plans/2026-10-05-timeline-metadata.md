# Timeline metadata interpretation (C7 M5)

Documentation only; no frozen timeline/schema/motion code changed.

- `captions[].rect` is the caption layout container. The rendered lines are vertically centered inside it and can occupy less area. It is not an ink-tight mask. Use measured glyph/line bounds for a mask, and the declared container for layout assertions.
- For a moving card, `cards[].element` identifies the image that receives zoom/motion. Enter/exit opacity belongs to `<element>-box`. Read `timeline.animations` by its actual `element` and property rather than assuming all card animations target the image.
- `rest` describes the interval where an element is at full opacity without its entrance/exit. It does not guarantee every pixel in its container contains ink.
- `checkAt` excludes movement/transition intervals; missing entries mean no eligible still frame, not that every frame was validated.
- Frozen documentation that still says the old issue cap, title or image-frame count is historical. The current compose output uses the cap 100, title `viraleditor`, and a still image frame count of 1. Update the frozen contract through the controller's contract process; this note does not change its version.

Ruling: retain the current container/image semantics. No schema version bump or change to drawn output is justified by this documentation issue.
