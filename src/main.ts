import "./styles.css";
import { WaveBackground } from "./wave-background";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CONFIG = {
  waveAmplitude: 0.26,
  waveThickness: 0.08,
  renderScale: 1.0,
  outputWidth: 1080,
  outputHeight: 1920,
  waveGradientA: [0.0, 0.72, 1.0] as [number, number, number],
  waveGradientB: [0.63, 0.0, 1.0] as [number, number, number],
  backgroundColor: [0.05, 0.07, 0.1] as [number, number, number],
};

// ---------------------------------------------------------------------------
// Canvas + WebGL context setup
// ---------------------------------------------------------------------------

const canvas = document.getElementById("waveCanvas") as HTMLCanvasElement;

const glContext =
  canvas.getContext("webgl", { preserveDrawingBuffer: true }) ||
  canvas.getContext("webgl");
if (!glContext) throw new Error("WebGL is not supported in this browser.");
const gl = glContext;

// ---------------------------------------------------------------------------
// WaveBackground
// ---------------------------------------------------------------------------

const wave = new WaveBackground(gl);

// ---------------------------------------------------------------------------
// Slider bindings
// ---------------------------------------------------------------------------

const shapeSlider = document.getElementById("shapeSlider") as HTMLInputElement;
const irregularitySlider = document.getElementById("irregularitySlider") as HTMLInputElement;
const densitySlider = document.getElementById("densitySlider") as HTMLInputElement;
const magnitudeSlider = document.getElementById("magnitudeSlider") as HTMLInputElement;
const meanderSlider = document.getElementById("meanderSlider") as HTMLInputElement;
const thicknessSlider = document.getElementById("thicknessSlider") as HTMLInputElement;
const randomizeGradientBtn = document.getElementById("randomizeGradientBtn") as HTMLButtonElement | null;
const splashHint = document.getElementById("splashHint") as HTMLElement | null;
const downloadCanvasBtn = document.getElementById("downloadCanvasBtn") as HTMLButtonElement | null;
const SPLASH_HINT_DISMISSED_KEY = "antiWrappedSplashHintDismissed";

let waveGradientA: [number, number, number] = [...CONFIG.waveGradientA];
let waveGradientB: [number, number, number] = [...CONFIG.waveGradientB];

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;

  if (h < 60) {
    r = c; g = x; b = 0;
  } else if (h < 120) {
    r = x; g = c; b = 0;
  } else if (h < 180) {
    r = 0; g = c; b = x;
  } else if (h < 240) {
    r = 0; g = x; b = c;
  } else if (h < 300) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }

  return [r + m, g + m, b + m];
}

function randomWaveGradient(): void {
  const baseHue = Math.random() * 360;
  const offset = 30 + Math.random() * 120;
  const hueA = baseHue;
  const hueB = (baseHue + offset) % 360;

  const satA = 0.55 + Math.random() * 0.35;
  const satB = 0.55 + Math.random() * 0.35;
  const valA = 0.75 + Math.random() * 0.22;
  const valB = 0.75 + Math.random() * 0.22;

  waveGradientA = hsvToRgb(hueA, satA, valA);
  waveGradientB = hsvToRgb(hueB, satB, valB);
}

function rgbArrayToCss(rgb: [number, number, number]): string {
  return `rgb(${Math.round(rgb[0] * 255)} ${Math.round(rgb[1] * 255)} ${Math.round(rgb[2] * 255)})`;
}

function syncPageThemeColors(): void {
  const root = document.documentElement;
  root.style.setProperty("--page-bg", rgbArrayToCss(CONFIG.backgroundColor));
}

function syncGradientButtonColors(): void {
  if (!randomizeGradientBtn) return;
  randomizeGradientBtn.style.setProperty("--splash-border-outer", rgbArrayToCss(waveGradientA));
  randomizeGradientBtn.style.setProperty("--splash-border-inner", rgbArrayToCss(waveGradientB));
}

if (randomizeGradientBtn) {
  randomizeGradientBtn.addEventListener("click", () => {
    randomWaveGradient();
    syncPageThemeColors();
    syncGradientButtonColors();
    scheduleRender();

    if (splashHint && !splashHint.classList.contains("is-hidden")) {
      splashHint.classList.add("is-hidden");
      try {
        localStorage.setItem(SPLASH_HINT_DISMISSED_KEY, "1");
      } catch {
        // Ignore storage failures (private mode / blocked storage).
      }
    }
  });
}

if (splashHint) {
  let splashHintDismissed = false;
  try {
    splashHintDismissed = localStorage.getItem(SPLASH_HINT_DISMISSED_KEY) === "1";
  } catch {
    splashHintDismissed = false;
  }

  if (splashHintDismissed) {
    splashHint.classList.add("is-hidden");
  }
}

syncPageThemeColors();
syncGradientButtonColors();

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

const imageOverlay = document.getElementById("imageOverlay") as HTMLCanvasElement;

async function downloadCanvasImage(): Promise<void> {
  const filename = `anti-wrapped-${Date.now()}.png`;

  // Render at full output resolution for the download.
  const fullW = CONFIG.outputWidth;
  const fullH = CONFIG.outputHeight;
  canvas.width = fullW;
  canvas.height = fullH;
  resizeImageOverlay();
  gl.viewport(0, 0, fullW, fullH);
  renderWave();
  await drawOverlay();

  const composite = document.createElement("canvas");
  composite.width = canvas.width;
  composite.height = canvas.height;
  const ctx = composite.getContext("2d")!;
  ctx.drawImage(canvas, 0, 0);
  ctx.drawImage(imageOverlay, 0, 0);

  composite.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    // Restore display resolution.
    scheduleRender();
  }, "image/png");
}

if (downloadCanvasBtn) {
  downloadCanvasBtn.addEventListener("click", downloadCanvasImage);
}

// ---------------------------------------------------------------------------
// Image overlay — for square album cover
// ---------------------------------------------------------------------------

const imageInput = document.getElementById("imageInput") as HTMLInputElement | null;
const clearImageBtn = document.getElementById("clearImageBtn") as HTMLButtonElement | null;
const titleInput = document.getElementById("titleInput") as HTMLInputElement | null;
const artistInput = document.getElementById("artistInput") as HTMLInputElement | null;
const ekphrasisInput = document.getElementById("ekphrasisInput") as HTMLInputElement | null;
const ekphrasisCounter = document.getElementById("ekphrasisCounter") as HTMLElement | null;
const imageCtx = imageOverlay.getContext("2d")!;

let currentImage: string | null = null;

function updateEkphrasisCounter(): void {
  if (!ekphrasisInput || !ekphrasisCounter) return;
  const maxChars = Number(ekphrasisInput.maxLength) || 110;
  const currentChars = ekphrasisInput.value.length;
  ekphrasisCounter.textContent = `${currentChars} / ${maxChars}`;
}

function cropToSquare(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const size = Math.min(img.width, img.height);
        const x = (img.width - size) / 2;
        const y = (img.height - size) / 2;

        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = size;
        tempCanvas.height = size;
        const tempCtx = tempCanvas.getContext("2d")!;
        tempCtx.drawImage(img, x, y, size, size, 0, 0, size, size);

        resolve(tempCanvas.toDataURL("image/png"));
      };
      img.src = e.target!.result as string;
    };
    reader.readAsDataURL(file);
  });
}

function drawOverlay(): Promise<void> {
  imageCtx.clearRect(0, 0, imageOverlay.width, imageOverlay.height);

  const imageSize = imageOverlay.width * 0.6;
  const imgX = (imageOverlay.width - imageSize) / 2;
  const imgY = imageOverlay.height * 0.29 - imageSize / 2;
  const textStartY = imgY + imageSize + 42;
  const centerX = imageOverlay.width / 2;

  function wrapText(text: string, maxWidth: number, maxLines: number): string[] {
    const words = text.split(" ");
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? current + " " + word : word;
      if (imageCtx.measureText(candidate).width <= maxWidth) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);

    if (lines.length <= maxLines) return lines;

    const truncated = lines.slice(0, maxLines);
    let last = truncated[maxLines - 1];
    while (last.length > 0 && imageCtx.measureText(last + "\u2026").width > maxWidth) {
      last = last.slice(0, -1).trimEnd();
    }
    truncated[maxLines - 1] = last + "\u2026";
    return truncated;
  }

  function drawText(): void {
    const title = titleInput?.value.trim() ?? "";
    const artist = artistInput?.value.trim() ?? "";
    const ekphrasis = ekphrasisInput?.value.trim() ?? "";

    imageCtx.textAlign = "center";
    imageCtx.textBaseline = "top";
    imageCtx.shadowColor = "rgba(0,0,0,0.55)";
    imageCtx.shadowBlur = 18;

    const maxTextWidth = imageOverlay.width * 0.74;
    const titleFontSize = Math.round(imageOverlay.width * 0.068);
    const artistFontSize = Math.round(imageOverlay.width * 0.046);
    const ekphrasisFontSize = Math.round(imageOverlay.width * 0.034);
    const titleLineHeight = Math.round(titleFontSize * 1.2);
    const ekphrasisLineHeight = Math.round(ekphrasisFontSize * 1.36);

    let cursorY = textStartY;

    if (title) {
      imageCtx.font = `bold ${titleFontSize}px sans-serif`;
      imageCtx.fillStyle = "#ffffff";
      const lines = wrapText(title, maxTextWidth, 2);
      lines.forEach((line, i) => {
        imageCtx.fillText(line, centerX, cursorY + i * titleLineHeight);
      });
      cursorY += lines.length * titleLineHeight;
    }

    if (artist) {
      cursorY += title ? Math.round(imageOverlay.width * 0.018) : 0;
      imageCtx.font = `${artistFontSize}px sans-serif`;
      imageCtx.fillStyle = "rgba(255,255,255,0.65)";
      imageCtx.fillText(artist, centerX, cursorY);
      cursorY += Math.round(artistFontSize * 1.3);
    }

    if (ekphrasis) {
      cursorY += Math.round(imageOverlay.width * 0.02);
      imageCtx.font = `${ekphrasisFontSize}px sans-serif`;
      imageCtx.fillStyle = "rgba(255,255,255,0.78)";
      const lines = wrapText(ekphrasis, maxTextWidth, 3);
      lines.forEach((line, i) => {
        imageCtx.fillText(line, centerX, cursorY + i * ekphrasisLineHeight);
      });
    }

    // Watermark
    const watermarkText = "anti-wrapped";
    const watermarkFontSize = Math.round(imageOverlay.width * 0.028);
    const wmX = Math.round(imageOverlay.width * 0.04);
    const wmY = imageOverlay.height - Math.round(imageOverlay.height * 0.06);
    imageCtx.font = `600 ${watermarkFontSize}px sans-serif`;
    imageCtx.textAlign = "left";
    imageCtx.textBaseline = "bottom";

    const wmMetrics = imageCtx.measureText(watermarkText);
    const wmPaddingX = Math.round(watermarkFontSize * 0.45);
    const wmPaddingY = Math.round(watermarkFontSize * 0.3);
    const wmBoxW = Math.ceil(wmMetrics.width + wmPaddingX * 2);
    const wmBoxH = Math.ceil(watermarkFontSize + wmPaddingY * 2);

    imageCtx.shadowColor = "rgba(0,0,0,0.2)";
    imageCtx.shadowBlur = 6;
    imageCtx.fillStyle = "rgba(0,0,0,0.2)";
    imageCtx.fillRect(wmX - wmPaddingX, wmY - watermarkFontSize - wmPaddingY, wmBoxW, wmBoxH);

    imageCtx.fillStyle = "rgba(255,255,255,0.58)";
    imageCtx.fillText(watermarkText, wmX, wmY);

    imageCtx.shadowBlur = 0;
  }

  if (!currentImage) {
    drawText();
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const radius = imageSize * 0.08;
      imageCtx.save();
      imageCtx.beginPath();
      imageCtx.moveTo(imgX + radius, imgY);
      imageCtx.lineTo(imgX + imageSize - radius, imgY);
      imageCtx.quadraticCurveTo(imgX + imageSize, imgY, imgX + imageSize, imgY + radius);
      imageCtx.lineTo(imgX + imageSize, imgY + imageSize - radius);
      imageCtx.quadraticCurveTo(imgX + imageSize, imgY + imageSize, imgX + imageSize - radius, imgY + imageSize);
      imageCtx.lineTo(imgX + radius, imgY + imageSize);
      imageCtx.quadraticCurveTo(imgX, imgY + imageSize, imgX, imgY + imageSize - radius);
      imageCtx.lineTo(imgX, imgY + radius);
      imageCtx.quadraticCurveTo(imgX, imgY, imgX + radius, imgY);
      imageCtx.closePath();
      imageCtx.clip();
      imageCtx.drawImage(img, imgX, imgY, imageSize, imageSize);
      imageCtx.restore();

      drawText();
      resolve();
    };
    img.src = currentImage!;
  });
}

function resizeImageOverlay(): void {
  imageOverlay.width = canvas.width;
  imageOverlay.height = canvas.height;
}

if (imageInput) {
  imageInput.addEventListener("change", async (e) => {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (file) {
      currentImage = await cropToSquare(file);
      drawOverlay();
    }
  });
}

if (clearImageBtn) {
  clearImageBtn.addEventListener("click", () => {
    currentImage = null;
    if (imageInput) imageInput.value = "";
    drawOverlay();
  });
}

let overlayTimer = 0;

/** Debounced overlay redraw */
function scheduleOverlay(): void {
  clearTimeout(overlayTimer);
  overlayTimer = window.setTimeout(drawOverlay, 500);
}

if (titleInput) {
  titleInput.addEventListener("input", scheduleOverlay);
}

if (artistInput) {
  artistInput.addEventListener("input", scheduleOverlay);
}

if (ekphrasisInput) {
  ekphrasisInput.addEventListener("input", () => {
    updateEkphrasisCounter();
    scheduleOverlay();
  });
}

updateEkphrasisCounter();

// ---------------------------------------------------------------------------
// Canvas resize
// ---------------------------------------------------------------------------

/** Compute display canvas size based on CSS layout size × devicePixelRatio,
 *  capped at the full output resolution. */
function displayCanvasSize(): [number, number] {
  const cssW = canvas.clientWidth || CONFIG.outputWidth;
  const cssH = canvas.clientHeight || CONFIG.outputHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  return [
    Math.min(Math.floor(cssW * dpr), CONFIG.outputWidth),
    Math.min(Math.floor(cssH * dpr), CONFIG.outputHeight),
  ];
}

function applyCanvasSize(w: number, h: number): void {
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    resizeImageOverlay();
    drawOverlay();
  }
  gl.viewport(0, 0, w, h);
}

function resizeCanvas(): void {
  const [w, h] = displayCanvasSize();
  applyCanvasSize(w, h);
}

// ---------------------------------------------------------------------------
// On-demand rendering (no animation — only re-render when inputs change)
// ---------------------------------------------------------------------------

let renderPending = false;

function scheduleRender(): void {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(renderFrame);
}

function renderFrame(): void {
  renderPending = false;
  resizeCanvas();
  renderWave();
}

function renderWave(): void {
  wave.render({
    shape: 1 - Number(shapeSlider.value),
    irregularity: Number(irregularitySlider.value),
    density: Number(densitySlider.value),
    meander: Number(meanderSlider.value),
    amplitude: magnitudeSlider ? Number(magnitudeSlider.value) : CONFIG.waveAmplitude,
    thickness: thicknessSlider ? Number(thicknessSlider.value) : CONFIG.waveThickness,
    waveColorA: waveGradientA,
    waveColorB: waveGradientB,
    backgroundColor: CONFIG.backgroundColor,
  });
}

// Re-render when sliders change.
for (const slider of [shapeSlider, irregularitySlider, densitySlider, magnitudeSlider, meanderSlider, thicknessSlider]) {
  if (slider) slider.addEventListener("input", scheduleRender);
}

window.addEventListener("resize", scheduleRender);
scheduleRender();
