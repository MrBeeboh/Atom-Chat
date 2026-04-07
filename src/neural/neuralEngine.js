/**
 * Neural Observatory v5 — Cinematic framing: one secondary, dock structural only, atmospheric field.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

const TARGET_FPS = 30;
const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;
const ROTATION_SPEED = 0.15;
const CORE_COLOR = 0xff00cc;
const PARTICLE_COUNT = 450;
const SECONDARY_HALO_DENSITY = 0.3;
const BLOOM_STRENGTH = 0.78;
const BLOOM_RADIUS = 0.6;
const BLOOM_THRESHOLD = 0.1;
const SHOCKWAVE_DURATION_MS = 600;
const PULSE_SPEED = 0.85;
const PULSE_SEGMENT_FRAC = 0.06;
const Z_DRIFT_AMP = 0.15;
const Z_DRIFT_FREQ = 0.0001;
const PRIMARY_RADIUS = 0.38;
const POLAR_TILT_X = 0.38;
const POLAR_TILT_Z = 0.10;
const SECONDARY_ORBIT_RADIUS = 0.92;
const SECONDARY_ORBIT_SPEED = 0.06;
const SECONDARY_RADIUS = 0.14;
const SECONDARY_OWN_ROTATION_SPEED = 2.2;

const PRIMARY_POSITION = new THREE.Vector3(-2.2, 0.65, -0.45);
const SECONDARY_POSITION = new THREE.Vector3(-2.8, 0.05, -1.1);
const SECONDARY_WIREFRAME_COLOR = 0x00ff99;
const SECONDARY_HALO_COLOR = 0x55ff88;

// Throughput heat: low -> cyan, medium -> violet, high -> hot pink
const COLOR_CYAN = new THREE.Color(0x00ffff);
const COLOR_VIOLET = new THREE.Color(0x9400d3);
const COLOR_PINK = new THREE.Color(0xff00cc);

function lerpColor(a, b, t) {
  const c = a.clone();
  return c.lerp(b, t);
}

function throughputColor(chunksPerSec) {
  const t = Math.min(1, chunksPerSec / 35);
  if (t <= 0.5) return lerpColor(COLOR_CYAN, COLOR_VIOLET, t * 2);
  return lerpColor(COLOR_VIOLET, COLOR_PINK, (t - 0.5) * 2);
}

/**
 * @param {HTMLElement} container
 * @param {(err: Error) => void} onError
 * @returns {{ start: () => void, stop: () => void, updateMetrics: (m: { isStreaming: boolean, liveChunksPerSec: number }) => void }}
 */
function createSecondaryNode(radius, orbitRadiusX, orbitRadiusY, orbitSpeed, orbitPhase, baseZ, opacity, rotationScale, wireframeColor = 0x00ffff, haloColor = 0x66fcf1) {
  const sphereGeom = new THREE.SphereGeometry(radius, 48, 48);
  const edgesGeom = new THREE.EdgesGeometry(sphereGeom);
  const mat = new THREE.LineBasicMaterial({
    color: wireframeColor,
    transparent: true,
    opacity,
  });
  const mesh = new THREE.LineSegments(edgesGeom, mat);
  mesh.renderOrder = 10;
  mesh.rotation.x = POLAR_TILT_X;
  mesh.rotation.z = POLAR_TILT_Z * 0.9;
  const haloCount = Math.max(20, Math.floor(PARTICLE_COUNT * SECONDARY_HALO_DENSITY));
  const haloGeom = new THREE.BufferGeometry();
  const haloPos = new Float32Array(haloCount * 3);
  const haloRadius = radius * 1.15;
  for (let i = 0; i < haloCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    haloPos[i * 3] = haloRadius * Math.sin(phi) * Math.cos(theta);
    haloPos[i * 3 + 1] = haloRadius * Math.sin(phi) * Math.sin(theta);
    haloPos[i * 3 + 2] = haloRadius * Math.cos(phi);
  }
  haloGeom.setAttribute('position', new THREE.BufferAttribute(haloPos, 3));
  const haloMat = new THREE.PointsMaterial({
    color: haloColor,
    size: 0.012,
    transparent: true,
    opacity: 0.25,
    blending: THREE.AdditiveBlending,
  });
  const haloMesh = new THREE.Points(haloGeom, haloMat);
  haloMesh.renderOrder = 10;
  return {
    mesh,
    haloMesh,
    sphereGeom,
    edgesGeom,
    mat,
    haloGeom,
    haloMat,
    rotationScale,
    orbitRadiusX,
    orbitRadiusY,
    orbitSpeed,
    orbitPhase,
    baseZ,
  };
}

export function createNeuralEngine(container, onError) {
  let scene = null;
  let camera = null;
  let renderer = null;
  let composer = null;
  let bloomPass = null;
  let neuralSystem = null;
  let wireframeMesh = null;
  let wireframeGeometry = null;
  let wireframeEdgesGeometry = null;
  let wireframeMaterial = null;
  let coreMesh = null;
  let coreGeometry = null;
  let coreMaterial = null;
  let shockwaveMesh = null;
  let shockwaveGeometry = null;
  let shockwaveMaterial = null;
  let points = null;
  let pointsGeometry = null;
  let pointsMaterial = null;
  let connectionLines = null;
  let connectionGeometry = null;
  let connectionMaterial = null;
  let pulseLines = null;
  let pulseGeometry = null;
  let pulseMaterial = null;
  let signalPhases = [0];
  let secondaryNodes = [];
  let rafId = null;
  let lastFrameTime = 0;
  let running = false;
  let visibilityUnsub = null;
  let metrics = { isStreaming: false, liveChunksPerSec: 0 };
  let prevStreaming = false;
  let pulsePhase = 0;
  let shockwaveStart = null;
  let particlePositions = null;
  let cameraBaseX = 0;
  let cameraBaseY = 0;
  let timeAccum = 0;
  let secondaryOrbitAngle = 0;
  let haloRadius = 0.82 * 0.82;
  const _vStart = new THREE.Vector3();
  const _vEnd = new THREE.Vector3();
  const _vDir = new THREE.Vector3();
  const _vCenter = new THREE.Vector3();
  const _polarAxis = new THREE.Vector3();
  const _equator1 = new THREE.Vector3();
  const _equator2 = new THREE.Vector3();
  const _vecZ = new THREE.Vector3(0, 0, 1);
  const _vecX = new THREE.Vector3(1, 0, 0);

  function updateMetrics(m) {
    metrics = { isStreaming: m?.isStreaming ?? false, liveChunksPerSec: m?.liveChunksPerSec ?? 0 };
  }

  function disposeMesh(mesh, geometry, material) {
    if (mesh && scene) scene.remove(mesh);
    if (geometry) geometry.dispose();
    if (material) material.dispose();
  }

  function stop() {
    running = false;
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (visibilityUnsub) {
      visibilityUnsub();
      visibilityUnsub = null;
    }
    secondaryNodes.forEach((n) => {
      n.sphereGeom?.dispose();
      n.edgesGeom?.dispose();
      n.mat?.dispose();
      n.haloGeom?.dispose();
      n.haloMat?.dispose();
    });
    secondaryNodes = [];
    connectionLines = null;
    connectionGeometry?.dispose();
    connectionGeometry = null;
    connectionMaterial?.dispose();
    connectionMaterial = null;
    pulseLines = null;
    pulseGeometry?.dispose();
    pulseGeometry = null;
    pulseMaterial?.dispose();
    pulseMaterial = null;
    if (neuralSystem && scene) scene.remove(neuralSystem);
    neuralSystem = null;
    disposeMesh(wireframeMesh, wireframeGeometry, wireframeMaterial);
    wireframeMesh = null;
    wireframeGeometry = null;
    wireframeMaterial = null;
    if (wireframeEdgesGeometry) wireframeEdgesGeometry.dispose();
    wireframeEdgesGeometry = null;
    disposeMesh(coreMesh, coreGeometry, coreMaterial);
    coreMesh = null;
    coreGeometry = null;
    coreMaterial = null;
    disposeMesh(shockwaveMesh, shockwaveGeometry, shockwaveMaterial);
    shockwaveMesh = null;
    shockwaveGeometry = null;
    shockwaveMaterial = null;
    if (points && scene) scene.remove(points);
    if (pointsGeometry) pointsGeometry.dispose();
    if (pointsMaterial) pointsMaterial.dispose();
    points = null;
    pointsGeometry = null;
    pointsMaterial = null;
    if (bloomPass) bloomPass.dispose?.();
    bloomPass = null;
    if (composer) {
      composer.dispose();
      composer = null;
    }
    scene = null;
    camera = null;
    if (renderer) {
      try {
        renderer.dispose();
      } catch (_) {}
      if (renderer.domElement?.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      renderer = null;
    }
  }

  function start() {
    if (running) return;
    try {
      scene = new THREE.Scene();
      scene.background = new THREE.Color(0x000000);
      camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 1000);
      camera.position.set(0, 0, 2.8);
      cameraBaseX = 0;
      cameraBaseY = 0;

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      renderer.setSize(container.clientWidth, container.clientHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      container.appendChild(renderer.domElement);

      neuralSystem = new THREE.Group();
      scene.add(neuralSystem);

      // Primary node: PRIMARY_RADIUS — smaller footprint, composed
      wireframeGeometry = new THREE.SphereGeometry(PRIMARY_RADIUS, 96, 96);
      wireframeEdgesGeometry = new THREE.EdgesGeometry(wireframeGeometry);
      wireframeMaterial = new THREE.LineBasicMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: 0.85,
      });
      wireframeMesh = new THREE.LineSegments(wireframeEdgesGeometry, wireframeMaterial);
      wireframeMesh.renderOrder = -10;
      wireframeMesh.position.copy(PRIMARY_POSITION);
      wireframeMesh.rotation.x = POLAR_TILT_X;
      wireframeMesh.rotation.z = POLAR_TILT_Z;
      neuralSystem.add(wireframeMesh);

      coreGeometry = new THREE.SphereGeometry(0.16, 48, 48);
      coreMaterial = new THREE.MeshBasicMaterial({
        color: CORE_COLOR,
        transparent: true,
        blending: THREE.AdditiveBlending,
      });
      coreMesh = new THREE.Mesh(coreGeometry, coreMaterial);
      coreMesh.renderOrder = -10;
      coreMesh.position.copy(PRIMARY_POSITION);
      neuralSystem.add(coreMesh);

      pointsGeometry = new THREE.BufferGeometry();
      particlePositions = new Float32Array(PARTICLE_COUNT * 3);
      // Particle field: true spherical distribution (no stretch)
      const primaryHaloRadius = 0.82 * 0.82;
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        particlePositions[i * 3] = primaryHaloRadius * Math.sin(phi) * Math.cos(theta);
        particlePositions[i * 3 + 1] = primaryHaloRadius * Math.sin(phi) * Math.sin(theta);
        particlePositions[i * 3 + 2] = primaryHaloRadius * Math.cos(phi);
      }
      pointsGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
      pointsMaterial = new THREE.PointsMaterial({
        color: 0x66fcf1,
        size: 0.02,
        transparent: true,
        opacity: 0.45,
        blending: THREE.AdditiveBlending,
      });
      points = new THREE.Points(pointsGeometry, pointsMaterial);
      points.renderOrder = -10;
      points.position.copy(PRIMARY_POSITION);
      neuralSystem.add(points);

      // Single secondary: orbits primary, greenish neon, same bloom energy as primary
      secondaryNodes = [
        createSecondaryNode(SECONDARY_RADIUS, 0, 0, 0, 0, -1.0, 0.37, 1, SECONDARY_WIREFRAME_COLOR, SECONDARY_HALO_COLOR),
      ];
      secondaryNodes.forEach((n) => {
        neuralSystem.add(n.mesh);
        neuralSystem.add(n.haloMesh);
      });

      // Base connection line: P → secondary only (positions updated each frame)
      const linePositions = new Float32Array(1 * 2 * 3);
      connectionGeometry = new THREE.BufferGeometry();
      connectionGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
      connectionMaterial = new THREE.LineBasicMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: 0.08,
        blending: THREE.AdditiveBlending,
      });
      connectionLines = new THREE.LineSegments(connectionGeometry, connectionMaterial);
      neuralSystem.add(connectionLines);

      // Traveling pulse: one segment P → secondary
      const pulsePositions = new Float32Array(1 * 2 * 3);
      pulseGeometry = new THREE.BufferGeometry();
      pulseGeometry.setAttribute('position', new THREE.BufferAttribute(pulsePositions, 3));
      pulseMaterial = new THREE.LineBasicMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
      });
      pulseLines = new THREE.LineSegments(pulseGeometry, pulseMaterial);
      neuralSystem.add(pulseLines);

      // Post-processing: bloom
      const resolution = new THREE.Vector2(container.clientWidth, container.clientHeight);
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      bloomPass = new UnrealBloomPass(resolution, BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
      composer.addPass(bloomPass);

      running = true;
      lastFrameTime = performance.now();
      prevStreaming = false;

      function onVisibilityChange() {
        if (document.visibilityState === 'hidden') {
          if (rafId != null) {
            cancelAnimationFrame(rafId);
            rafId = null;
          }
        } else if (running && renderer) {
          lastFrameTime = performance.now();
          rafId = requestAnimationFrame(loop);
        }
      }
      document.addEventListener('visibilitychange', onVisibilityChange);
      visibilityUnsub = () => document.removeEventListener('visibilitychange', onVisibilityChange);

      function loop(now) {
        if (!running || !renderer || !wireframeMesh) return;
        rafId = requestAnimationFrame(loop);
        const elapsed = now - lastFrameTime;
        if (elapsed < FRAME_INTERVAL_MS) return;
        lastFrameTime = now;
        const dt = elapsed / 1000;
        timeAccum += elapsed;

        // Shockwave on stream start
        if (metrics.isStreaming && !prevStreaming) {
          shockwaveStart = now;
          if (!shockwaveMesh) {
            shockwaveGeometry = new THREE.TorusGeometry(0.9, 0.02, 8, 64);
            shockwaveMaterial = new THREE.MeshBasicMaterial({
              color: 0xff00cc,
              transparent: true,
              opacity: 0.8,
              blending: THREE.AdditiveBlending,
            });
            shockwaveMesh = new THREE.Mesh(shockwaveGeometry, shockwaveMaterial);
            shockwaveMesh.position.copy(PRIMARY_POSITION);
            neuralSystem.add(shockwaveMesh);
          }
          bloomPass.strength = 2.2;
        }
        prevStreaming = metrics.isStreaming;

        if (shockwaveMesh && shockwaveStart != null && neuralSystem) {
          const age = now - shockwaveStart;
          if (age >= SHOCKWAVE_DURATION_MS) {
            neuralSystem.remove(shockwaveMesh);
            shockwaveGeometry.dispose();
            shockwaveMaterial.dispose();
            shockwaveMesh = null;
            shockwaveGeometry = null;
            shockwaveMaterial = null;
            shockwaveStart = null;
            bloomPass.strength = BLOOM_STRENGTH;
          } else {
            const t = age / SHOCKWAVE_DURATION_MS;
            shockwaveMesh.scale.setScalar(1 + t * 2.5);
            shockwaveMaterial.opacity = 0.8 * (1 - t);
          }
        } else if (bloomPass && !shockwaveStart) {
          bloomPass.strength = BLOOM_STRENGTH;
        }

        // Secondary: orbits in the primary's equatorial plane (not tidally locked; has own rotation)
        secondaryOrbitAngle += dt * SECONDARY_ORBIT_SPEED;
        const px = PRIMARY_POSITION.x, py = PRIMARY_POSITION.y, pz = PRIMARY_POSITION.z;
        _polarAxis.set(0, 1, 0).applyEuler(new THREE.Euler(POLAR_TILT_X, 0, POLAR_TILT_Z));
        _equator1.crossVectors(_polarAxis, _vecZ);
        if (_equator1.lengthSq() < 1e-6) _equator1.crossVectors(_polarAxis, _vecX);
        _equator1.normalize();
        _equator2.crossVectors(_polarAxis, _equator1).normalize();
        const n0 = secondaryNodes[0].mesh.position;
        n0.x = px + SECONDARY_ORBIT_RADIUS * (Math.cos(secondaryOrbitAngle) * _equator1.x + Math.sin(secondaryOrbitAngle) * _equator2.x);
        n0.y = py + SECONDARY_ORBIT_RADIUS * (Math.cos(secondaryOrbitAngle) * _equator1.y + Math.sin(secondaryOrbitAngle) * _equator2.y);
        n0.z = pz + SECONDARY_ORBIT_RADIUS * (Math.cos(secondaryOrbitAngle) * _equator1.z + Math.sin(secondaryOrbitAngle) * _equator2.z);
        secondaryNodes[0].haloMesh.position.copy(n0);

        // When green is in front of blue (camera side), scale it up slightly so it wins depth and stays green
        _vStart.set(px, py, pz);
        _vDir.set(camera.position.x - px, camera.position.y - py, camera.position.z - pz);
        _vCenter.set(n0.x - px, n0.y - py, n0.z - pz);
        const greenInFront = _vCenter.dot(_vDir) > 0;
        const frontScale = greenInFront ? 1.14 : 1;
        secondaryNodes[0].mesh.scale.setScalar(frontScale);
        secondaryNodes[0].haloMesh.scale.setScalar(frontScale);

        // Base connection line: P → secondary only
        const connPos = connectionGeometry.attributes.position.array;
        connPos[0] = px; connPos[1] = py; connPos[2] = pz;
        connPos[3] = n0.x; connPos[4] = n0.y; connPos[5] = n0.z;
        connectionGeometry.attributes.position.needsUpdate = true;

        // Base connection opacity: slightly brighter when streaming (cinematic alive)
        if (connectionMaterial) {
          connectionMaterial.opacity = metrics.isStreaming ? 0.22 : 0.08;
        }

        // Traveling pulse: single segment P → secondary (only when streaming)
        if (pulseLines && pulseGeometry && pulseMaterial) {
          pulseLines.visible = metrics.isStreaming;
          if (metrics.isStreaming) {
            const pulsePos = pulseGeometry.attributes.position.array;
            signalPhases[0] += dt * PULSE_SPEED;
            if (signalPhases[0] >= 1) signalPhases[0] = 0;
            _vStart.set(px, py, pz);
            _vEnd.set(n0.x, n0.y, n0.z);
            _vCenter.copy(_vStart).lerp(_vEnd, signalPhases[0]);
            _vDir.copy(_vEnd).sub(_vStart);
            const len = _vDir.length();
            if (len > 1e-6) {
              _vDir.normalize();
              const halfSeg = len * PULSE_SEGMENT_FRAC * 0.5;
              _vDir.multiplyScalar(halfSeg);
              pulsePos[0] = _vCenter.x - _vDir.x; pulsePos[1] = _vCenter.y - _vDir.y; pulsePos[2] = _vCenter.z - _vDir.z;
              pulsePos[3] = _vCenter.x + _vDir.x; pulsePos[4] = _vCenter.y + _vDir.y; pulsePos[5] = _vCenter.z + _vDir.z;
            }
            pulseGeometry.attributes.position.needsUpdate = true;
          }
        }

        // Primary: subtle vertical breathing (barely perceptible)
        const breatheAmp = 0.025;
        const breatheFreq = 0.0006;
        const breathY = PRIMARY_POSITION.y + Math.sin(timeAccum * breatheFreq) * breatheAmp;
        wireframeMesh.position.x = PRIMARY_POSITION.x;
        wireframeMesh.position.y = breathY;
        wireframeMesh.position.z = PRIMARY_POSITION.z;
        coreMesh.position.copy(wireframeMesh.position);
        points.position.copy(wireframeMesh.position);

        // Rotation: primary — polar axis only (axis tilted via POLAR_TILT_X/Z at init)
        wireframeMesh.rotation.y += ROTATION_SPEED * dt;
        coreMesh.rotation.copy(wireframeMesh.rotation);
        points.rotation.copy(wireframeMesh.rotation);

        // Rotation: secondaries — independent spin (not tidally locked; ~1 rotation per ~4 orbits)
        secondaryNodes.forEach((n) => {
          n.mesh.rotation.y += SECONDARY_OWN_ROTATION_SPEED * dt;
          n.haloMesh.rotation.copy(n.mesh.rotation);
        });

        // Throughput heat color (primary only)
        wireframeMaterial.color.copy(throughputColor(metrics.liveChunksPerSec));

        // Pulse (primary wireframe + core) when streaming only
        if (metrics.isStreaming) {
          pulsePhase += elapsed * 0.003;
          const s = 0.88 + 0.12 * Math.sin(pulsePhase);
          wireframeMesh.scale.setScalar(s);
          const corePulse = 0.9 + 0.2 * Math.sin(pulsePhase * 1.3);
          coreMesh.scale.setScalar(corePulse);
        } else {
          wireframeMesh.scale.setScalar(1);
          coreMesh.scale.setScalar(1);
        }

        // Core: subtle when idle, full presence when streaming (the "explode" moment)
        const coreGlow = 0.85 + 0.15 * Math.sin(timeAccum * 0.002);
        coreMaterial.opacity = metrics.isStreaming ? coreGlow * 0.9 : coreGlow * 0.38;

        // Primary particle halo: outward drift when streaming, ease back when idle
        if (metrics.isStreaming) haloRadius = Math.min(1.05 * 0.82, haloRadius + dt * 0.12);
        else haloRadius = Math.max(0.82 * 0.82, haloRadius - dt * 0.15);
        const pos = pointsGeometry.attributes.position.array;
        for (let i = 0; i < PARTICLE_COUNT; i++) {
          const i3 = i * 3;
          const x = pos[i3], y = pos[i3 + 1], z = pos[i3 + 2];
          const r = Math.sqrt(x * x + y * y + z * z) || 1;
          pos[i3] = (x / r) * haloRadius;
          pos[i3 + 1] = (y / r) * haloRadius;
          pos[i3 + 2] = (z / r) * haloRadius;
        }
        pointsGeometry.attributes.position.needsUpdate = true;

        // Camera drift (slow sin/cos)
        const drift = 0.12;
        camera.position.x = cameraBaseX + Math.sin(timeAccum * 0.00025) * drift;
        camera.position.y = cameraBaseY + Math.cos(timeAccum * 0.0002) * drift;
        camera.position.z = 2.8;
        camera.lookAt(0.1, 0, 0);
        camera.updateMatrixWorld();

        composer.render();
      }

      if (document.visibilityState !== 'hidden') {
        rafId = requestAnimationFrame(loop);
      }
    } catch (err) {
      onError(err);
      stop();
    }
  }

  function handleResize() {
    if (!camera || !renderer || !container) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    if (composer) {
      composer.setSize(w, h);
      composer.setPixelRatio(renderer.getPixelRatio());
    }
  }
  window.addEventListener('resize', handleResize);
  const origStop = stop;
  stop = () => {
    window.removeEventListener('resize', handleResize);
    origStop();
  };

  return { start, stop, updateMetrics };
}
