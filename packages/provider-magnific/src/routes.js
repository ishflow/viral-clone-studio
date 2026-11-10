import {
  compileWireRequest,
  generationTypes,
  mappingSupportsRequest,
  sealGeneratedImageSet,
  sealGeneratedVideoSet,
  selectWireModelForRequest,
} from "@hypit/hypit/generation";
import { canonicalize } from "@hypit/hypit/endpoint-kit";

/**
 * Magnific REST endpoints for the exact Hypit capabilities this package implements.
 * Field names, enums and limits come from the OpenAPI schema on docs.magnific.com.
 */

const SEEDANCE = { name: "@hypit/seedance", version: "1" };
const NANO_BANANA = { name: "@hypit/nano-banana", version: "1" };
const GPT_IMAGE = { name: "@hypit/gpt-image", version: "1" };

const MiB = 1024 * 1024;
const MB = 1000 * 1000;

/** Magnific names ratios; Seedance and GPT Image 2 share these six, GPT Image 2 adds four. */
const SEEDANCE_RATIOS = {
  "1:1": "square_1_1", "4:3": "classic_4_3", "3:4": "traditional_3_4",
  "16:9": "widescreen_16_9", "9:16": "social_story_9_16", "21:9": "film_horizontal_21_9",
};
const GPT_RATIOS = {
  ...SEEDANCE_RATIOS,
  "3:2": "standard_3_2", "2:3": "portrait_2_3", "2:1": "horizontal_2_1", "3:1": "banner_3_1",
};

/** Media types the upload API accepts, after normalizing common aliases. */
const UPLOAD_TYPE_ALIASES = { "image/jpg": "image/jpeg", "audio/x-wav": "audio/wav", "audio/wave": "audio/wav", "audio/mp3": "audio/mpeg" };
export function uploadContentType(mediaType) {
  const base = mediaType.split(";", 1)[0].trim().toLowerCase();
  return UPLOAD_TYPE_ALIASES[base] ?? base;
}
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const SEEDANCE_VIDEO_TYPES = ["video/mp4", "video/quicktime"];
const SEEDANCE_AUDIO_TYPES = ["audio/mpeg", "audio/wav"];

function scalar(request, port) {
  const value = request.ports[port]?.[0];
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : undefined;
}
function items(request, port) {
  return request.ports[port] ?? [];
}
function capabilityKey(capability) {
  return `${capability.module.name}@${capability.module.version}#${capability.name}`;
}

/** Checks each supplied media item's type and size; future (pending) items are checked at execution. */
function mediaRejection(request, rules) {
  let total = 0;
  for (const [port, rule] of Object.entries(rules.ports)) {
    for (const item of items(request, port)) {
      const artifact = item?.artifact;
      if (artifact === undefined) continue;
      const type = uploadContentType(artifact.mediaType);
      if (!rule.types.includes(type)) {
        return `Magnific ${rules.label} ${rule.noun} must be ${rule.types.join(", ")}, not ${artifact.mediaType}`;
      }
      if (rule.maxBytes !== undefined && artifact.size > rule.maxBytes) {
        return `Magnific ${rules.label} ${rule.noun} is limited to ${rule.limitText}; this one is ${Math.ceil(artifact.size / MiB)} MiB`;
      }
      total += artifact.size;
    }
  }
  if (rules.maxTotalBytes !== undefined && total > rules.maxTotalBytes) {
    return `Magnific ${rules.label} accepts at most ${rules.totalText} of references in one request`;
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Seedance: one endpoint per variant and resolution; references are plain URL arrays.

const seedanceVariants = {
  "seedance-2": {
    label: "Seedance 2.0 Pro", submit: (res) => `seedance-2-pro-${res}`, poll: () => "seedance-2-pro",
    resolutions: ["480p", "720p", "1080p", "4k"], maxSeconds: 15,
    counts: { referenceImage: 9, referenceVideo: 3, referenceAudio: 3 }, audioNeedsVisual: true, videoBytes: 50 * MB,
  },
  "seedance-2-fast": {
    label: "Seedance 2.0 Fast", submit: (res) => `seedance-2-fast-${res}`, poll: () => "seedance-2-fast",
    resolutions: ["480p", "720p"], maxSeconds: 15,
    counts: { referenceImage: 9, referenceVideo: 3, referenceAudio: 3 }, audioNeedsVisual: true, videoBytes: 50 * MB,
  },
  "seedance-2-mini": {
    label: "Seedance 2.0 Mini", submit: (res) => `seedance-2-mini-${res}`, poll: () => "seedance-2-mini",
    resolutions: ["480p", "720p"], maxSeconds: 15,
    counts: { referenceImage: 9, referenceVideo: 3, referenceAudio: 3 }, audioNeedsVisual: true, videoBytes: 50 * MB,
  },
  "seedance-2.5": {
    label: "Seedance 2.5 Pro", submit: (res) => `seedance-2-5-pro-${res}`, poll: (res) => `seedance-2-5-pro-${res}`,
    resolutions: ["480p", "720p", "1080p"], maxSeconds: 30,
    counts: { referenceImage: 30, referenceVideo: 10, referenceAudio: 10 }, audioNeedsVisual: false, videoBytes: 200 * MB,
  },
};

/**
 * Compiled first into these field names, then finished by seedanceBody(): `resolution` selects the
 * endpoint path, `web_search` is never sent, ratios are renamed and `sound_effects` gains `no_music`.
 * `personReference` is accepted on visual references and not transmitted: Magnific has no field for it.
 */
const seedanceMapping = (name) => ({
  capability: { module: SEEDANCE, name }, result: "video", routes: [{ model: name }],
  fields: {
    prompt: { as: "value", field: "prompt" },
    referenceImage: { as: "urlArray", field: "reference_images", resourceFields: ["personReference"] },
    referenceVideo: { as: "urlArray", field: "reference_videos", resourceFields: ["personReference"] },
    referenceAudio: { as: "urlArray", field: "reference_audios" },
    firstFrame: { as: "url", field: "image", resourceFields: ["personReference"] },
    lastFrame: { as: "url", field: "image_end", resourceFields: ["personReference"] },
    resolution: { as: "value", field: "resolution" },
    aspectRatio: { as: "value", field: "aspect_ratio" },
    duration: { as: "value", field: "duration" },
    generateAudio: { as: "value", field: "sound_effects" },
    webSearch: { as: "value", field: "web_search" },
  },
});

function seedanceRejection(variant, request, pending) {
  const has = (port) => items(request, port).length > 0 || pending.includes(port);
  if (scalar(request, "webSearch") === true) return "Magnific's Seedance endpoints have no web search field";
  const resolution = scalar(request, "resolution");
  if (resolution === undefined) return "Magnific selects the Seedance endpoint by resolution; the request states none";
  if (!variant.resolutions.includes(resolution)) {
    return `Magnific ${variant.label} renders at ${variant.resolutions.join(", ")}, not ${resolution}`;
  }
  const duration = scalar(request, "duration");
  if (typeof duration === "number" && (duration < 4 || duration > variant.maxSeconds)) {
    return duration === -1
      ? `Magnific ${variant.label} has no automatic (-1) duration; state 4 to ${variant.maxSeconds} seconds`
      : `Magnific ${variant.label} renders 4 to ${variant.maxSeconds} seconds, not ${duration}`;
  }
  if (scalar(request, "aspectRatio") === "adaptive" && !has("firstFrame")) {
    return "Magnific has no adaptive aspect ratio for text- or reference-to-video (it would render 16:9); state the ratio";
  }
  for (const [port, max] of Object.entries(variant.counts)) {
    const count = items(request, port).length;
    if (count > max) return `Magnific ${variant.label} accepts at most ${max} ${port} items, not ${count}`;
  }
  if (variant.audioNeedsVisual && has("referenceAudio") && !has("referenceImage") && !has("referenceVideo")) {
    return `Magnific ${variant.label} requires a reference image or video alongside reference audio`;
  }
  return mediaRejection(request, {
    label: variant.label,
    ports: {
      referenceImage: { noun: "reference image", types: IMAGE_TYPES },
      firstFrame: { noun: "first frame", types: IMAGE_TYPES },
      lastFrame: { noun: "last frame", types: IMAGE_TYPES },
      referenceVideo: { noun: "reference video", types: SEEDANCE_VIDEO_TYPES, maxBytes: variant.videoBytes, limitText: `${variant.videoBytes / MB} MB` },
      referenceAudio: {
        noun: "reference audio", types: SEEDANCE_AUDIO_TYPES,
        ...(variant.audioNeedsVisual ? { maxBytes: 15 * MB, limitText: "15 MB" } : {}),
      },
    },
  });
}

function seedanceBody(input) {
  const { resolution: _resolution, web_search: _webSearch, ...body } = input;
  if (body.aspect_ratio === "adaptive") delete body.aspect_ratio; // frame mode: output follows the first frame
  else if (body.aspect_ratio !== undefined) body.aspect_ratio = SEEDANCE_RATIOS[body.aspect_ratio];
  // Native audio keeps dialogue and sound effects without a generated music bed.
  if (body.sound_effects === true) body.no_music = true;
  return body;
}

// ---------------------------------------------------------------------------------------------
// Images

/** Nano Banana Pro takes `{ image, mime_type }` reference objects; nanoBananaBody() builds them. */
const nanoBananaProMapping = {
  capability: { module: NANO_BANANA, name: "nano-banana-pro" }, result: "image",
  routes: [{ model: "nano-banana-pro" }],
  constants: { num_images: 1 },
  fields: {
    prompt: { as: "value", field: "prompt" },
    images: { as: "urlArray", field: "reference_images" },
    aspectRatio: { as: "value", field: "aspect_ratio" },
    resolution: { as: "value", field: "resolution" },
    outputFormat: { as: "value", field: "output_format" },
  },
};

function nanoBananaRejection(request) {
  const format = scalar(request, "outputFormat");
  if (format !== undefined && format !== "png") {
    return `Magnific's Nano Banana Pro endpoint has no output format field and returns PNG, not ${format}`;
  }
  if (items(request, "images").length > 14) return "Magnific Nano Banana Pro accepts at most 14 reference images";
  return mediaRejection(request, { label: "Nano Banana Pro", ports: { images: { noun: "reference image", types: IMAGE_TYPES } } });
}

function nanoBananaBody(input, mediaTypes) {
  const { output_format: _format, reference_images: references, ...body } = input;
  if (references !== undefined) {
    body.reference_images = references.map((image) => ({ image, mime_type: mediaTypes.get(image) }));
  }
  return body;
}

/** GPT Image 2 renders from a prompt on one endpoint and edits supplied images on another. */
const gptImage2Mapping = {
  capability: { module: GPT_IMAGE, name: "gpt-image-2" }, result: "image",
  routes: [{ model: "gpt-image-2-edit", whenPresent: ["images"] }, { model: "gpt-image-2" }],
  constants: { num_images: 1 },
  fields: {
    prompt: { as: "value", field: "prompt" },
    images: { as: "urlArray", field: "reference_images" },
    aspectRatio: { as: "value", field: "aspect_ratio" },
    resolution: { as: "value", field: "resolution" },
    background: { as: "value", field: "background" },
  },
};

function gptImage2Rejection(request) {
  const ratio = scalar(request, "aspectRatio");
  if (ratio !== undefined && GPT_RATIOS[ratio] === undefined) {
    return `Magnific GPT Image 2 offers ${Object.keys(GPT_RATIOS).join(", ")}, not ${ratio}`;
  }
  if (scalar(request, "background") === "transparent") {
    return "Magnific GPT Image 2 offers background opaque or auto, not transparent";
  }
  return mediaRejection(request, {
    label: "GPT Image 2", maxTotalBytes: 64 * MiB, totalText: "64 MiB",
    ports: { images: { noun: "reference image", types: IMAGE_TYPES, maxBytes: 20 * MiB, limitText: "20 MiB" } },
  });
}

function gptImage2Body(input) {
  const body = { ...input };
  if (body.aspect_ratio !== undefined) body.aspect_ratio = GPT_RATIOS[body.aspect_ratio];
  if (body.resolution !== undefined) body.resolution = String(body.resolution).toLowerCase();
  return body;
}

// ---------------------------------------------------------------------------------------------

const definitions = [
  ...Object.entries(seedanceVariants).map(([name, variant]) => ({
    mapping: seedanceMapping(name),
    rejection: (request, pending) => seedanceRejection(variant, request, pending),
    paths: (request) => {
      const resolution = scalar(request, "resolution");
      return { submit: `/v1/ai/video/${variant.submit(resolution)}`, poll: `/v1/ai/video/${variant.poll(resolution)}` };
    },
    listPaths: [...new Set(variant.resolutions.map((res) => `/v1/ai/video/${variant.poll(res)}`))],
    body: (input) => seedanceBody(input),
  })),
  {
    mapping: nanoBananaProMapping,
    rejection: (request) => nanoBananaRejection(request),
    paths: () => ({ submit: "/v1/ai/text-to-image/nano-banana-pro", poll: "/v1/ai/text-to-image/nano-banana-pro" }),
    listPaths: ["/v1/ai/text-to-image/nano-banana-pro"],
    body: (input, mediaTypes) => nanoBananaBody(input, mediaTypes),
  },
  {
    mapping: gptImage2Mapping,
    rejection: (request) => gptImage2Rejection(request),
    paths: (request) => {
      const path = `/v1/ai/text-to-image/${selectWireModelForRequest(gptImage2Mapping, request)}`;
      return { submit: path, poll: path };
    },
    listPaths: ["/v1/ai/text-to-image/gpt-image-2", "/v1/ai/text-to-image/gpt-image-2-edit"],
    body: (input) => gptImage2Body(input),
  },
];

function rejectionFor(definition, request, pending) {
  if (!mappingSupportsRequest(definition.mapping, request)) return "Magnific cannot carry one of the requested inputs";
  const unmapped = pending.find((port) => definition.mapping.fields[port] === undefined);
  if (unmapped !== undefined) return `Magnific cannot carry the future input ${unmapped}`;
  return definition.rejection(request, pending);
}

export const magnificRoutes = definitions.map((definition) => ({
  key: capabilityKey(definition.mapping.capability),
  capability: definition.mapping.capability,
  mapping: definition.mapping,
  media: definition.mapping.result,
  returns: definition.mapping.result === "image" ? generationTypes.imageSet : generationTypes.videoSet,
  listPaths: definition.listPaths,
  supports(endpointRequest) {
    const pending = endpointRequest.pendingInputs?.map((slot) => slot.input) ?? [];
    const reason = rejectionFor(definition, endpointRequest.constraints, pending);
    return reason === undefined ? { status: "supported" } : { status: "unsupported", reason };
  },
  /** Validates the request and names its endpoints before any reference is uploaded. */
  prepare(constraints) {
    const reason = rejectionFor(definition, constraints, []);
    if (reason !== undefined) throw new Error(reason);
    const paths = definition.paths(constraints);
    return {
      ...paths,
      async compile(resolve) {
        const mediaTypes = new Map();
        const { input } = await compileWireRequest(definition.mapping, constraints, async (artifact, fields) => {
          const url = await resolve(artifact, fields);
          mediaTypes.set(url, uploadContentType(artifact.mediaType));
          return url;
        });
        return definition.body({ ...input }, mediaTypes);
      },
    };
  },
  packageResult(blobs) {
    return {
      kind: "inline",
      value: canonicalize(definition.mapping.result === "image"
        ? sealGeneratedImageSet({ images: blobs })
        : sealGeneratedVideoSet({ videos: blobs })),
    };
  },
}));

const byKey = new Map(magnificRoutes.map((route) => [route.key, route]));

export function magnificRouteForCapability(capability) {
  return byKey.get(capabilityKey(capability));
}
