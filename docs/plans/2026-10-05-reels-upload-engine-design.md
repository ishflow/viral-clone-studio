# Reels links and real video uploads: engine design only

No implementation is authorised in this handover. The site already exposes `addFromUpload`; that does not prove the real engine can prepare uploaded video. Instagram's host passing the cheap check does not prove a Reel is downloadable.

## Proposed input contract

Keep the site's `OwnSource` distinction. Extend the engine's frozen prepare input in a separately approved revision with `{ kind: 'upload'; uploadId: string }`; store an opaque upload id, never a caller-provided disk path. Existing link/candidate inputs remain valid. A migration is needed only if durable input records or source-kind constraints change; the current templates table already admits `upload`.

For a Reel, accept an HTTPS public Instagram `/reel/<id>/` URL after canonicalisation. Strip tracking parameters, reject credentials/ports, unsupported hosts and private/login-required content. The downloader must enforce HTTPS and allowed public destinations on every redirect, stream a bounded response, and pass a local downloaded container to the decoder. Do not pass remote manifests/playlists to transcription. Reuse existing downloader/process isolation and container admission; verify the redirect/private-address protections before release.

## Upload custody and preparation

1. Authenticate at the upload route; require upload ownership again when creating the prepare run. Derive its location from the server's upload registry. Enforce byte/type/length/vertical-ratio rules server-side, with bounded probing and timeout. Browser metadata is advisory.
2. Copy or lease the admitted video into an attempt-specific local source directory. Reject symlinks and paths outside the data root. An active prepare lease must protect both the upload and source against retirement.
3. Reuse the local analysis, score, template writing and validation stages. Skip URL download for an upload. Keep a persisted source identity/checksum so a retry cannot silently analyse different bytes.
4. Preserve the existing transaction: source admission and allowance checks, a durable held run and site charge, then release only after the charge is durable. Idempotency keys must prevent repeated charges and duplicate prepares. Refused preparation refunds the original charge lot once.
5. Access to private upload/source/template files remains owner-scoped; account deletion and retention must deny access immediately and retire only after active leases finish. Physical deletion/backups require a separate retention decision.

## Free confirmation metadata

`SourceCheck.shots` is nullable. Use an already analysed, visible source's actual shot count. An unknown Reel/upload has no count until analysis; render the UI's unknown state. Do not invent five shots, perform a paid model call in the free check, or infer speech format from filename/container. If product requirements demand a count before confirmation, approve a bounded local scene-detection/cache design separately.

`Template.referenceLikes` follows the existing board's like-rate presentation (`likes / views × 100`, one decimal), rather than an absolute like count. Missing/invalid/zero-view metrics stay null. Uploaded videos normally have no public engagement metrics.

## Required release evidence

Tests must cover public Reel success with recorded/offline fixtures; private/login-required/unsupported sources; redirects to forbidden addresses; streamed oversize and playlist masquerades; malformed containers; cross-owner upload ids; traversal/symlinks; concurrent retry/charge/refund; crash recovery and active-lease retention. One real local MP4/MOV upload must reach a ready private template through the SQLite worker, with no downloader call, then pass the existing generation path. No live or paid provider call is part of this design note.
