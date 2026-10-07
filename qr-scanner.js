import {assetUrl,runtimeConfig} from './paths.js';
import {linkedInvitation,childRoomLink} from './room-entry.js';

/**
 * Local-only scanner. Scanned URLs are never navigated to or fetched.
 * Only the current site's exact base-scoped play URL and room invitation pass.
 */
export function decodeRoomEntry(text, origin, appBase=runtimeConfig.appBase) {
  if (typeof text !== 'string' || typeof origin !== 'string' || !/^https?:\/\/[^/?#@\\\s]+\//.test(text)) return null;
  try {
    const entry = new URL(text);
    const invitation = linkedInvitation(entry.search);
    if (!invitation || text !== childRoomLink(origin, invitation.code, invitation.inviteToken, appBase)) return null;
    return invitation;
  } catch { return null; }
}

const ERRORS = {
  'camera-unsupported': '이 브라우저에서는 카메라를 쓸 수 없어요. 선생님의 초대 링크로 들어가 주세요.',
  'camera-insecure': '카메라는 안전한 HTTPS 주소에서 열 수 있어요. 선생님의 초대 링크로 들어가 주세요.',
  'camera-permission-denied': '카메라가 허용되지 않았어요. 브라우저에서 허용하거나 선생님의 초대 링크로 들어가 주세요.',
  'camera-not-found': '카메라를 찾지 못했어요. 선생님의 초대 링크로 들어가 주세요.',
  'camera-unavailable': '카메라를 열지 못했어요. 다른 카메라 앱을 닫거나 선생님의 초대 링크로 들어가 주세요.',
  'camera-start-failed': '카메라를 시작하지 못했어요. 다시 열거나 선생님의 초대 링크로 들어가 주세요.',
  'camera-play-failed': '카메라 화면을 열지 못했어요. 다시 열거나 선생님의 초대 링크로 들어가 주세요.',
  'decoder-load-failed': 'QR 읽기를 준비하지 못했어요. 다시 열거나 선생님의 초대 링크로 들어가 주세요.',
  'scan-failed': '카메라 화면을 읽지 못했어요. 다시 열거나 선생님의 초대 링크로 들어가 주세요.'
};

function mediaErrorCode(error) {
  if (['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(error?.name)) return 'camera-permission-denied';
  if (['NotFoundError', 'DevicesNotFoundError'].includes(error?.name)) return 'camera-not-found';
  if (['NotReadableError', 'TrackStartError', 'OverconstrainedError', 'ConstraintNotSatisfiedError'].includes(error?.name)) return 'camera-unavailable';
  return 'camera-start-failed';
}

/**
 * Production options: video, canvas, origin, onRoom({code,inviteToken}), onError({code,message}),
 * onStatus(message). Optional adapters support permission-free unit tests:
 * mediaDevices, decoder, loadDecoder, setTimeout, clearTimeout, now, isSecureContext.
 * start() resolves true once scanning starts, false on cancellation/start failure.
 * Repeated start() calls while active share the pending/result promise.
 * stop() is synchronous and idempotent. Call it on dialog close and page teardown.
 */
export function createQrScanner({
  video,
  canvas,
  origin,
  appBase = runtimeConfig.appBase,
  onRoom = () => {},
  onError = () => {},
  onStatus = () => {},
  mediaDevices = globalThis.navigator?.mediaDevices,
  decoder,
  loadDecoder = () => import(assetUrl('vendor/jsqr.js')).then(module => module.default),
  setTimeout: schedule = globalThis.setTimeout.bind(globalThis),
  clearTimeout: cancel = globalThis.clearTimeout.bind(globalThis),
  now = () => Date.now(),
  isSecureContext = globalThis.isSecureContext ?? true,
  fps = 8,
  maxDimension = 640,
  statusRepeatMs = 2500
} = {}) {
  if (!video || !canvas) throw new TypeError('A video and canvas are required.');
  const frameDelay = 1000 / Math.min(10, Math.max(5, Number(fps) || 8));
  const frameLimit = Math.min(640, Math.max(1, Number(maxDimension) || 640));
  const statusDelay = Math.max(1000, Number(statusRepeatMs) || 2500);
  let active = null;

  function current(run) {
    return active === run && !run.cancelled;
  }

  function stopTracks(stream) {
    for (const track of stream?.getTracks?.() ?? []) {
      try { track.stop(); } catch { /* Continue releasing the other tracks. */ }
    }
  }

  function release(run) {
    if (run.timer !== null) cancel(run.timer);
    run.timer = null;
    const stream = run.stream;
    run.stream = null;
    if (stream) {
      stopTracks(stream);
      if (video.srcObject === stream) {
        try { video.pause?.(); } catch { /* Clear the stream even if pause fails. */ }
        video.srcObject = null;
      }
    }
  }

  function stop() {
    const run = active;
    if (!run) return;
    active = null;
    run.cancelled = true;
    release(run);
  }

  function status(run, message) {
    if (!current(run)) return;
    const time = now();
    if (run.lastStatus === message && time - run.lastStatusAt < statusDelay) return;
    run.lastStatus = message;
    run.lastStatusAt = time;
    onStatus(message);
  }

  function fail(run, code) {
    if (!current(run)) return;
    stop();
    onError({ code, message: ERRORS[code] });
  }

  function queueFrame(run) {
    if (!current(run)) return;
    run.timer = schedule(() => {
      run.timer = null;
      scanFrame(run);
    }, frameDelay);
  }

  function scanFrame(run) {
    if (!current(run)) return;
    try {
      const sourceWidth = video.videoWidth;
      const sourceHeight = video.videoHeight;
      if (video.readyState >= 2 && Number.isFinite(sourceWidth) && Number.isFinite(sourceHeight) && sourceWidth > 0 && sourceHeight > 0) {
        const scale = Math.min(1, frameLimit / Math.max(sourceWidth, sourceHeight));
        const width = Math.max(1, Math.round(sourceWidth * scale));
        const height = Math.max(1, Math.round(sourceHeight * scale));
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        run.context.drawImage(video, 0, 0, width, height);
        const pixels = run.context.getImageData(0, 0, width, height);
        const result = run.decoder(pixels.data, width, height, { inversionAttempts: 'attemptBoth' });
        if (!current(run)) return;
        if (result?.data) {
          const room = decodeRoomEntry(result.data, origin, appBase);
          if (room) {
            // Release the camera before the application receives the room invitation.
            stop();
            onRoom(room);
            return;
          }
          status(run, '이 놀이의 QR이 아니에요. 선생님 화면의 QR을 비춰 주세요.');
        }
      }
    } catch {
      fail(run, 'scan-failed');
      return;
    }
    queueFrame(run);
  }

  async function begin(run) {
    if (!isSecureContext) {
      fail(run, 'camera-insecure');
      return false;
    }
    if (typeof mediaDevices?.getUserMedia !== 'function') {
      fail(run, 'camera-unsupported');
      return false;
    }
    try {
      run.context = canvas.getContext('2d', { willReadFrequently: true });
      if (!run.context) throw new Error('Canvas unavailable.');
    } catch {
      fail(run, 'scan-failed');
      return false;
    }
    try {
      run.decoder = decoder ?? await loadDecoder();
      if (typeof run.decoder !== 'function') throw new Error('Decoder unavailable.');
    } catch {
      fail(run, 'decoder-load-failed');
      return false;
    }
    if (!current(run)) return false;
    status(run, '카메라 허용을 기다리고 있어요…');
    if (!current(run)) return false;
    let stream;
    try {
      // Only explicit start() reaches this permission-triggering operation.
      stream = await mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });
    } catch (error) {
      fail(run, mediaErrorCode(error));
      return false;
    }
    if (!current(run)) {
      stopTracks(stream);
      return false;
    }
    run.stream = stream;
    try {
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();
    } catch {
      fail(run, 'camera-play-failed');
      return false;
    }
    if (!current(run)) return false;
    status(run, '선생님 화면의 QR을 카메라에 비춰 주세요.');
    if (!current(run)) return false;
    queueFrame(run);
    return true;
  }

  function start() {
    if (active) return active.promise ?? Promise.resolve(false);
    const run = {
      cancelled: false,
      stream: null,
      timer: null,
      context: null,
      decoder: null,
      promise: null,
      lastStatus: null,
      lastStatusAt: -Infinity
    };
    active = run;
    run.promise = begin(run);
    return run.promise;
  }

  return { start, stop };
}
