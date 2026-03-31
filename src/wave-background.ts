// ---------------------------------------------------------------------------
// Shader sources
// ---------------------------------------------------------------------------

const VERTEX_SHADER_SOURCE = `
attribute vec2 aPosition;
varying vec2 vUv;

void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SOURCE = `
precision highp float;

varying vec2 vUv;

uniform vec2  uResolution;
uniform float uShape;
uniform float uIrregularity;
uniform float uDensity;
uniform float uAmplitude;
uniform float uThickness;
uniform vec3  uWaveColorA;
uniform vec3  uWaveColorB;
uniform vec3  uBackgroundColor;
uniform float uMeander;

float hash(float n) {
  return fract(sin(n) * 43758.5453123);
}

float noise1D(float x) {
  float i = floor(x);
  float f = fract(x);
  float u = f * f * (3.0 - 2.0 * f);
  return mix(hash(i), hash(i + 1.0), u);
}

// Layered 1-D noise (4 octaves) — drives smooth spatial variation.
float fbm1D(float x) {
  float value = 0.0;
  float amp   = 0.5;
  float freq  = 1.0;
  value += amp * noise1D(x * freq); freq *= 2.03; amp *= 0.5;
  value += amp * noise1D(x * freq); freq *= 2.01; amp *= 0.5;
  value += amp * noise1D(x * freq); freq *= 2.02; amp *= 0.5;
  value += amp * noise1D(x * freq);
  return value / 0.9375;
}

// Band-limited harmonic saw approximation — blends from sine (smooth) to
// pseudo-saw (angular) without phase discontinuities.
float sawLikeContinuous(float phase, float shape) {
  float roughness  = 1.0 - shape;
  float fundamental = sin(phase);
  // Path runs diagonally, so effective pixels per phase span both axes.
  float pathPx     = max(uResolution.x, uResolution.y) * 1.41421356;
  float phasePixel = (2.0 * 3.14159265 * mix(2.0, 30.0, uDensity)) / pathPx;
  float footprint  = max(phasePixel * (1.0 + 0.7 * uIrregularity), 0.0001);

  float sum  = 0.0;
  float norm = 0.0;

  for (float k = 1.0; k <= 7.0; k += 1.0) {
    float w = 1.0 / k;
    float d = exp(-footprint * k * k);
    sum  += w * d * sin(k * phase);
    norm += w * d;
  }

  float sawApprox = norm > 0.0 ? sum / norm : fundamental;
  float sawMix    = clamp(pow(roughness, 0.65), 0.0, 1.0);
  return mix(fundamental, sawApprox, sawMix);
}

void main() {
  // Convert UV to symmetric [-1,1]x[-1,1] clip coordinates.
  float px = vUv.x * 2.0 - 1.0;
  float py = vUv.y * 2.0 - 1.0;

  // Rotate into path frame:
  //   u — along the bottom-left → top-right diagonal
  //   v — perpendicular (positive = upper-left of diagonal)
  float INV_SQRT2 = 0.70710678;
  float u = ( px + py) * INV_SQRT2;
  float v = (-px + py) * INV_SQRT2;

  // t in [0,1]: progress from bottom-left (t=0) to top-right (t=1).
  // u ranges from -sqrt2 at (-1,-1) to +sqrt2 at (1,1).
  float SQRT2    = 1.41421356;
  float t        = (u + SQRT2) / (2.0 * SQRT2);
  float t_c      = clamp(t, 0.0, 1.0);

  // Fade the wave in/out smoothly at the entry and exit edges.
  float endpoint_fade = smoothstep(0.0, 0.04, t) * smoothstep(1.0, 0.96, t);

  // --- Meander: neutral at midpoint, opposite extremes at each end ---
  // uMeander is 0..2 where 1.0 is the neutral center.
  float meanderNorm = clamp(uMeander * 0.5, 0.0, 1.0);
  float meanderSigned = (meanderNorm - 0.5) * 2.0; // -1..1
  float meanderDirection = sign(meanderSigned);
  float meanderAmount = smoothstep(0.0, 1.0, abs(meanderSigned));

  // Blend broad spine movement with higher-frequency jitter for chaos.
  float meanderGain = pow(meanderAmount, 0.82) * 6.2;
  float lowFreqWander = fbm1D(t_c * 3.4 + 37.1) - 0.5;
  float hiFreqWander  = fbm1D(t_c * 18.0 + 149.7) - 0.5;
  float chaoticWander = lowFreqWander + hiFreqWander * (0.42 + 0.38 * meanderAmount);
  float v_spine = meanderDirection * meanderGain * chaoticWander;

  // Pixel position relative to the meandering spine.
  float v_rel = v - v_spine;

  // --- Density: sparse <-> busy cycle count ---
  float cycles = mix(1.5, 30.0, uDensity);

  // --- Smooth phase envelope (varies calmness/aggression along path) ---
  float phaseEnvelope          = fbm1D(t_c * mix(1.0, 5.5, uDensity) + 71.3);
  float amplitudePhaseScale    = mix(0.65, 1.7,  phaseEnvelope);
  float irregularityPhaseScale = mix(0.7,  1.45, phaseEnvelope);

  // --- Irregularity: noise fields for phase and amplitude jitter ---
  float nFreq  = fbm1D(t_c * mix(1.5, 20.0, uDensity) + 3.7);
  float nAmp   = fbm1D(t_c * mix(0.9, 14.0, uDensity) + 17.1);
  float nShape = fbm1D(t_c * mix(1.2, 18.0, uDensity) + 101.9);

  float localIrregularity = uIrregularity * irregularityPhaseScale;
  float tWarp = (nFreq - 0.5) * 0.42 * localIrregularity;
  float phase = (t_c + tWarp) * cycles * 2.0 * 3.14159265;
  phase += (nAmp - 0.5) * 4.4 * localIrregularity;

  // --- Shape: angular <-> smooth, perturbed by irregularity ---
  float localShape = clamp(uShape + (nShape - 0.5) * 0.75 * localIrregularity, 0.0, 1.0);

  float ampJitter = mix(1.0, 0.35 + nAmp * 1.5, localIrregularity) * amplitudePhaseScale;
  ampJitter = clamp(ampJitter, 0.22, 2.8);
  float waveV = sawLikeContinuous(phase, localShape) * uAmplitude * ampJitter;

  // --- Anti-aliasing: 3-tap sample in the v (perpendicular) direction ---
  float pixelV = 1.5 / max(uResolution.y, 1.0);
  float aa     = pixelV * 1.8;
  float dv0 = abs(v_rel - waveV);
  float dv1 = abs((v_rel - 0.65 * pixelV) - waveV);
  float dv2 = abs((v_rel + 0.65 * pixelV) - waveV);
  float m0 = 1.0 - smoothstep(uThickness - aa, uThickness + aa, dv0);
  float m1 = 1.0 - smoothstep(uThickness - aa, uThickness + aa, dv1);
  float m2 = 1.0 - smoothstep(uThickness - aa, uThickness + aa, dv2);
  float lineMask = (m0 + m1 + m2) / 3.0 * endpoint_fade;

  vec3 waveGradientColor = mix(uWaveColorA, uWaveColorB, t_c);
  gl_FragColor = vec4(mix(uBackgroundColor, waveGradientColor, lineMask), 1.0);
}
`;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Failed to create shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error("WaveBackground shader compile error:\n" + info);
  }
  return shader;
}

function linkProgram(gl: WebGLRenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error("Failed to create program");
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error("WaveBackground program link error:\n" + info);
  }
  return program;
}

// ---------------------------------------------------------------------------
// WaveBackground class
// ---------------------------------------------------------------------------

export interface WaveRenderParams {
  shape?: number;
  irregularity?: number;
  density?: number;
  amplitude?: number;
  thickness?: number;
  waveColorA?: [number, number, number];
  waveColorB?: [number, number, number];
  backgroundColor?: [number, number, number];
  meander?: number;
}

interface UniformLocations {
  resolution: WebGLUniformLocation | null;
  shape: WebGLUniformLocation | null;
  irregularity: WebGLUniformLocation | null;
  density: WebGLUniformLocation | null;
  amplitude: WebGLUniformLocation | null;
  thickness: WebGLUniformLocation | null;
  waveColorA: WebGLUniformLocation | null;
  waveColorB: WebGLUniformLocation | null;
  backgroundColor: WebGLUniformLocation | null;
  meander: WebGLUniformLocation | null;
}

export class WaveBackground {
  private _gl: WebGLRenderingContext;
  private _program: WebGLProgram | null;
  private _positionBuffer: WebGLBuffer | null;
  private _positionLocation: number;
  private _u: UniformLocations;
  private _colorBuf = new Float32Array(3);

  constructor(gl: WebGLRenderingContext) {
    this._gl = gl;

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
    this._program = linkProgram(gl, vs, fs);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    this._positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    this._positionLocation = gl.getAttribLocation(this._program, "aPosition");

    this._u = {
      resolution: gl.getUniformLocation(this._program, "uResolution"),
      shape: gl.getUniformLocation(this._program, "uShape"),
      irregularity: gl.getUniformLocation(this._program, "uIrregularity"),
      density: gl.getUniformLocation(this._program, "uDensity"),
      amplitude: gl.getUniformLocation(this._program, "uAmplitude"),
      thickness: gl.getUniformLocation(this._program, "uThickness"),
      waveColorA: gl.getUniformLocation(this._program, "uWaveColorA"),
      waveColorB: gl.getUniformLocation(this._program, "uWaveColorB"),
      backgroundColor: gl.getUniformLocation(this._program, "uBackgroundColor"),
      meander: gl.getUniformLocation(this._program, "uMeander"),
    };
  }

  render({
    shape = 0.5,
    irregularity = 0.4,
    density = 0.5,
    amplitude = 0.36,
    thickness = 0.08,
    waveColorA = [0.0, 0.72, 1.0],
    waveColorB = [0.63, 0.0, 1.0],
    backgroundColor = [0.05, 0.07, 0.1],
    meander = 0,
  }: WaveRenderParams = {}): void {
    const gl = this._gl;

    // --- Save GL state we are about to touch ---
    const savedProgram = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
    const savedArrayBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null;
    const savedAttribEnabled = gl.getVertexAttrib(
      this._positionLocation,
      gl.VERTEX_ATTRIB_ARRAY_ENABLED,
    ) as boolean;
    const savedDepthTest = gl.isEnabled(gl.DEPTH_TEST);

    if (savedDepthTest) gl.disable(gl.DEPTH_TEST);

    const viewport = gl.getParameter(gl.VIEWPORT) as Int32Array;

    gl.useProgram(this._program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._positionBuffer);
    gl.enableVertexAttribArray(this._positionLocation);
    gl.vertexAttribPointer(this._positionLocation, 2, gl.FLOAT, false, 0, 0);

    gl.uniform2f(this._u.resolution, viewport[2], viewport[3]);
    gl.uniform1f(this._u.shape, shape);
    gl.uniform1f(this._u.irregularity, irregularity);
    gl.uniform1f(this._u.density, density);
    gl.uniform1f(this._u.amplitude, amplitude);
    gl.uniform1f(this._u.thickness, thickness);
    gl.uniform3fv(this._u.waveColorA, this._setColorBuf(waveColorA));
    gl.uniform3fv(this._u.waveColorB, this._setColorBuf(waveColorB));
    gl.uniform3fv(this._u.backgroundColor, this._setColorBuf(backgroundColor));
    gl.uniform1f(this._u.meander, meander);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // --- Restore GL state ---
    if (!savedAttribEnabled) gl.disableVertexAttribArray(this._positionLocation);
    gl.bindBuffer(gl.ARRAY_BUFFER, savedArrayBuffer);
    gl.useProgram(savedProgram);
    if (savedDepthTest) gl.enable(gl.DEPTH_TEST);
  }

  private _setColorBuf(c: [number, number, number]): Float32Array {
    this._colorBuf[0] = c[0];
    this._colorBuf[1] = c[1];
    this._colorBuf[2] = c[2];
    return this._colorBuf;
  }

  destroy(): void {
    const gl = this._gl;
    if (this._program) gl.deleteProgram(this._program);
    if (this._positionBuffer) gl.deleteBuffer(this._positionBuffer);
    this._program = null;
    this._positionBuffer = null;
  }
}
