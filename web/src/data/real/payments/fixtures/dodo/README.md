# Dodo webhook fixtures

Hand-written from the Dodo Payments OpenAPI schema (docs read 2026-10-07): `PaymentResponse`,
`RefundResponse`, `DisputeResponse` inside the `{business_id, type, timestamp, data}` envelope.
Every id, address and amount is made up. None of these bodies was captured from a real delivery,
so field presence and casing still need one real test-mode event to confirm.

Tests read the files as raw text, because the signature covers the exact bytes.
