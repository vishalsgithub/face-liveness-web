import { useEffect, useRef, useState } from 'react';

import {
  DEFAULT_LIVENESS_THRESHOLD,
  FaceLiveness,
  type LivenessError,
  type LivenessFace,
  type LivenessResult,
} from '@solankivishal/face-liveness-web';
import { FaceLivenessCamera } from '@solankivishal/face-liveness-web/react';

const REQUIRED_LIVE_FRAMES = 8;

export default function App() {
  const [tab, setTab] = useState<'camera' | 'photo'>('camera');
  return (
    <main className="app">
      <header className="header">
        <h1>Face Liveness</h1>
        <p>Real face or photo? Checked entirely in your browser; nothing is uploaded.</p>
        <nav className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'camera'} onClick={() => setTab('camera')}>
            Camera
          </button>
          <button role="tab" aria-selected={tab === 'photo'} onClick={() => setTab('photo')}>
            Photo
          </button>
        </nav>
      </header>
      {tab === 'camera' ? <CameraCheck /> : <PhotoCheck />}
      <footer className="footer">
        <a href="https://github.com/vishalsgithub/face-liveness-web">GitHub</a> ·{' '}
        <a href="https://www.npmjs.com/package/@solankivishal/face-liveness-web">npm</a>
      </footer>
    </main>
  );
}

function CameraCheck() {
  const [result, setResult] = useState<LivenessResult | null>(null);
  const [error, setError] = useState<LivenessError | null>(null);
  const [verified, setVerified] = useState(false);
  const [threshold, setThreshold] = useState(DEFAULT_LIVENESS_THRESHOLD);

  const face = result?.face;
  const status = error
    ? { text: error.message, tone: 'warn' }
    : !result
      ? { text: 'Starting camera…', tone: 'muted' }
      : !face
        ? { text: 'Position your face in the frame', tone: 'muted' }
        : result.isVerified
          ? { text: '✓ Real face', tone: 'live' }
          : face.isLive
            ? { text: 'Checking…', tone: 'info' }
            : { text: 'Spoof detected', tone: 'spoof' };

  return (
    <section className="panel">
      <FaceLivenessCamera
        className="camera"
        livenessThreshold={threshold}
        requiredLiveFrames={REQUIRED_LIVE_FRAMES}
        onResult={(r) => {
          setResult(r);
          setError(null);
          if (!r.face?.isLive) setVerified(false);
        }}
        onVerified={() => setVerified(true)}
        onError={setError}
      />
      <div className={`status ${status.tone}`} data-testid="camera-status">
        <div className="row">
          <strong>{status.text}</strong>
          {face && <span className="score">{face.livenessScore.toFixed(3)}</span>}
        </div>
        <div className="track">
          <div
            className="bar"
            style={{ width: `${Math.min(1, (result?.consecutiveLiveFrames ?? 0) / REQUIRED_LIVE_FRAMES) * 100}%` }}
          />
        </div>
        <div className="caption">
          {verified ? 'Verified · ' : ''}
          {Math.round(result?.processingTimeMs ?? 0)} ms / frame
        </div>
        <label className="slider">
          Threshold {threshold.toFixed(3)}
          <input
            type="range"
            min={0.5}
            max={0.99}
            step={0.005}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
          />
        </label>
      </div>
    </section>
  );
}

function PhotoCheck() {
  const engine = useRef<Promise<FaceLiveness> | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [faces, setFaces] = useState<LivenessFace[]>([]);
  const [message, setMessage] = useState('Choose a photo, or try the sample.');

  useEffect(() => {
    return () => {
      void engine.current?.then((e) => e.dispose());
    };
  }, []);

  async function check(blob: Blob) {
    setUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(blob);
    });
    setFaces([]);
    setMessage('Analysing…');
    try {
      engine.current ??= FaceLiveness.create();
      const liveness = await engine.current;
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      setSize({ width: bitmap.width, height: bitmap.height });
      bitmap.close();
      const detected = await liveness.detect(blob);
      setFaces(detected);
      const top = detected[0];
      setMessage(
        top
          ? `${top.isLive ? 'Real face' : 'Spoof'} · score ${top.livenessScore.toFixed(3)}`
          : 'No face found.'
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section className="panel photo">
      <div className="preview">
        {url && size ? (
          <div className="frame" style={{ aspectRatio: `${size.width} / ${size.height}` }}>
            <img src={url} alt="Checked photo" />
            {faces.map((f, i) => (
              <div
                key={i}
                className={`box ${f.isLive ? 'live' : 'spoof'}`}
                style={{
                  left: `${(f.bounds.x / size.width) * 100}%`,
                  top: `${(f.bounds.y / size.height) * 100}%`,
                  width: `${(f.bounds.width / size.width) * 100}%`,
                  height: `${(f.bounds.height / size.height) * 100}%`,
                }}
              />
            ))}
          </div>
        ) : (
          <div className="placeholder">No photo yet</div>
        )}
      </div>
      <p className="message" data-testid="photo-result">
        {message}
      </p>
      <div className="actions">
        <label className="button">
          Choose photo
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void check(file);
            }}
          />
        </label>
        <button
          className="button secondary"
          data-testid="sample-button"
          onClick={async () => check(await (await fetch('./sample-face.jpg')).blob())}
        >
          Try sample
        </button>
      </div>
    </section>
  );
}
