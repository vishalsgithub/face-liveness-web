import { useEffect, useRef, type CSSProperties } from 'react';

import { LivenessCamera, type LivenessCameraOptions } from './camera.js';
import type { LivenessError, LivenessResult } from './types.js';

export type FaceLivenessCameraProps = Omit<LivenessCameraOptions, 'onResult' | 'onVerified' | 'onError'> & {
  onResult?: (result: LivenessResult) => void;
  onVerified?: (result: LivenessResult) => void;
  onError?: (error: LivenessError) => void;
  /** Pause the camera without unmounting. Default true. */
  active?: boolean;
  style?: CSSProperties;
  className?: string;
};

/**
 * Camera that checks every frame for a real face.
 *
 * ```tsx
 * <FaceLivenessCamera
 *   style={{ width: '100%', height: 480 }}
 *   onVerified={(r) => console.log('Real face', r.face?.livenessScore)}
 * />
 * ```
 */
export function FaceLivenessCamera({
  onResult,
  onVerified,
  onError,
  active = true,
  style,
  className,
  ...options
}: FaceLivenessCameraProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<LivenessCamera | null>(null);

  // Keep the latest callbacks without restarting the camera.
  const callbacks = useRef({ onResult, onVerified, onError });
  callbacks.current = { onResult, onVerified, onError };

  useEffect(() => {
    const camera = new LivenessCamera(containerRef.current!, {
      ...options,
      onResult: (r) => callbacks.current.onResult?.(r),
      onVerified: (r) => callbacks.current.onVerified?.(r),
      onError: (e) => callbacks.current.onError?.(e),
    });
    cameraRef.current = camera;
    return () => {
      cameraRef.current = null;
      void camera.dispose();
    };
    // The engine is fixed for the lifetime of the component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.engine]);

  useEffect(() => {
    cameraRef.current?.setOptions({
      livenessThreshold: options.livenessThreshold,
      requiredLiveFrames: options.requiredLiveFrames,
      facingMode: options.facingMode,
      showFaceOverlay: options.showFaceOverlay,
    });
  }, [options.livenessThreshold, options.requiredLiveFrames, options.facingMode, options.showFaceOverlay]);

  useEffect(() => {
    const camera = cameraRef.current;
    if (!camera) return;
    if (active) void camera.start();
    else camera.stop();
  }, [active, options.engine]);

  return <div ref={containerRef} className={className} style={{ position: 'relative', ...style }} />;
}
