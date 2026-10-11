/** Default liveness threshold, same as the original Android sample. */
export const DEFAULT_LIVENESS_THRESHOLD = 0.915;

export type Rect = { x: number; y: number; width: number; height: number };

/** A detected face and its liveness result. */
export type LivenessFace = {
  /** Face bounds in pixels of the image. */
  bounds: Rect;
  /** Face detector confidence in [0, 1]. */
  detectionConfidence: number;
  /** Probability that the face is real (not a photo, screen or mask) in [0, 1]. */
  livenessScore: number;
  /** `livenessScore >= livenessThreshold`. */
  isLive: boolean;
};

/** Result of one processed camera frame. */
export type LivenessResult = {
  /** Largest face in the frame, or null when no face was found. */
  face: LivenessFace | null;
  /** Face rectangle in the camera element's CSS pixels, or null. */
  faceFrameInView: Rect | null;
  /** Size of the camera frame that `face.bounds` refers to. */
  imageSize: { width: number; height: number };
  /** Inference time for this frame in milliseconds. */
  processingTimeMs: number;
  /** Number of consecutive frames (including this one) with a live face. */
  consecutiveLiveFrames: number;
  /** True once a face has been live for `requiredLiveFrames` consecutive frames. */
  isVerified: boolean;
};

export type LivenessErrorCode =
  | 'permission-denied'
  | 'camera-unavailable'
  | 'engine-error';

export class LivenessError extends Error {
  constructor(
    readonly code: LivenessErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'LivenessError';
  }
}

export type EngineOptions = {
  /**
   * Base URL of the model files (`detection/…`, `live/…`). Defaults to the copies
   * shipped next to this package, resolved by your bundler.
   */
  modelBaseUrl?: string;
  /** Minimum face size in pixels. Default 64. */
  minFaceSize?: number;
  /** Minimum face detector confidence. Default 0.6. */
  faceDetectionThreshold?: number;
};

// --- Worker protocol (internal) ---------------------------------------------------

export type WorkerRequest =
  | { id: number; type: 'init'; modelUrls: Record<string, string>; minFaceSize: number; faceDetectionThreshold: number }
  | { id: number; type: 'detect'; pixels: ArrayBuffer; width: number; height: number; allFaces: boolean }
  | { id: number; type: 'dispose' };

export type WorkerResponse =
  | { id: number; ok: true; faces?: Float32Array; simd?: boolean }
  | { id: number; ok: false; error: string };
