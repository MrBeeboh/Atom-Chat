/**
 * Extract a small number of evenly spaced frames from a video file as image data URLs.
 * Used so vision models (e.g. MiniCPM-V) that support multiple images can "see" video
 * via a frame sequence. LM Studio's API is image-based; sending frames uses existing image input.
 *
 * @param {File} file - Video file (e.g. video/mp4, video/webm)
 * @param {{ count?: number, maxDurationSec?: number, timeoutMs?: number }} [opts] - count: frames to extract (default 8); maxDurationSec: cap duration for long videos (default 60); timeoutMs: max time to wait (default 25000)
 * @returns {Promise<string[]>} Data URLs (JPEG) for each frame
 */
export function videoToFrames(file, opts = {}) {
  const count = Math.min(16, Math.max(2, opts.count ?? 8));
  const maxDurationSec = opts.maxDurationSec ?? 60;
  const timeoutMs = opts.timeoutMs ?? 25000;

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.preload = 'auto';

    let settled = false;
    function finish(handler) {
      return (...args) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        video.pause();
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(url);
        handler(...args);
      };
    }
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      video.pause();
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      reject(new Error('Video took too long to process. Try a shorter clip or a different format (e.g. MP4).'));
    }, timeoutMs);

    video.onerror = () => finish(reject)(new Error('Video failed to load or format not supported.'));
    video.onloadedmetadata = () => {
      const duration = Math.min(video.duration, maxDurationSec);
      if (duration <= 0 || !isFinite(duration)) {
        finish(reject)(new Error('Could not read video duration'));
        return;
      }
      const times = [];
      for (let i = 0; i < count; i++) {
        times.push((duration * (i + 0.5)) / count);
      }

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const results = /** @type {string[]} */ ([]);
      let index = 0;

      function captureFrame() {
        if (index >= times.length) {
          const valid = results.filter((u) => u.length > 0);
          finish(valid.length > 0 ? resolve : reject)(valid.length > 0 ? valid : new Error('Could not decode video frames. Try another format (e.g. MP4 with H.264).'));
          return;
        }
        const t = times[index];
        video.currentTime = t;
      }

      video.onseeked = () => {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (w > 0 && h > 0) {
          canvas.width = w;
          canvas.height = h;
          ctx.drawImage(video, 0, 0);
          try {
            const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
            results.push(dataUrl);
          } catch (e) {
            results.push('');
          }
        }
        index++;
        captureFrame();
      };

      captureFrame();
    };

    video.src = url;
  });
}
