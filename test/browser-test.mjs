// End-to-end test of the demo in real Chrome with a fake camera streaming face.y4m.
//   (cd ../demo && npx vite build && npx vite preview --port 4173 &)
//   node browser-test.mjs [url]
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const url = process.argv[2] ?? 'http://localhost:4173/';
const video = fileURLToPath(new URL('./face.y4m', import.meta.url));
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${video}`,
  ],
});
let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
  if (!ok) failed = true;
};

try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('page error:', e.message));
  page.on('console', (m) => m.type() === 'error' && console.log('console error:', m.text()));
  await page.setViewport({ width: 420, height: 900, deviceScaleFactor: 2 });
  await page.goto(url, { waitUntil: 'networkidle0' });

  // Camera tab: the fake camera streams face.y4m. The live score must match what the
  // native engine reports for the same frame (fas_cli on face_frame.png).
  await page.waitForFunction(
    () => /\d\.\d{3}/.test(document.querySelector('[data-testid=camera-status] .score')?.textContent ?? ''),
    { timeout: 60000 }
  );
  await new Promise((r) => setTimeout(r, 2000));
  const status = await page.$eval('[data-testid=camera-status]', (el) => el.textContent ?? '');
  const cameraScore = Number(await page.$eval('[data-testid=camera-status] .score', (el) => el.textContent));
  // Save the exact decoded frame the page analyses, for comparison with the native engine.
  const png = await page.$eval('video', (video) => {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  writeFileSync(fileURLToPath(new URL('./decoded_frame.png', import.meta.url)), Buffer.from(png, 'base64'));
  const native = process.env.NATIVE_CLI
    ? Number(/liveness ([0-9.]+)/.exec(execFileSync(process.env.NATIVE_CLI, [process.env.MODEL_DIR, fileURLToPath(new URL('./decoded_frame.png', import.meta.url))]).toString())?.[1])
    : NaN;
  check(
    'camera score matches native engine on the same frame',
    Number.isNaN(native) ? cameraScore > 0 : Math.abs(cameraScore - native) < 0.02, // browser vs CoreGraphics image decoding differs slightly
    `web ${cameraScore.toFixed(4)} vs native ${Number.isNaN(native) ? 'n/a' : native.toFixed(4)} (${status})`
  );
  await page.screenshot({ path: fileURLToPath(new URL('./camera.png', import.meta.url)) });

  // Photo tab: sample photo through FaceLiveness.detect(Blob).
  await page.click('button[role=tab]:nth-of-type(2)');
  await page.click('[data-testid=sample-button]');
  await page.waitForFunction(
    () => /score|No face|rror/.test(document.querySelector('[data-testid=photo-result]')?.textContent ?? ''),
    { timeout: 60000 }
  );
  const photo = await page.$eval('[data-testid=photo-result]', (el) => el.textContent ?? '');
  const score = Number(/score ([0-9.]+)/.exec(photo)?.[1] ?? 0);
  check('photo is a real face', photo.startsWith('Real face') && score > 0.9, photo);
  await page.screenshot({ path: fileURLToPath(new URL('./photo.png', import.meta.url)) });
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
