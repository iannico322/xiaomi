import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

// ─── Scene Setup ────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
const container = document.getElementById('canvas-container');
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 5;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
// Prevent unnecessary clears — we have alpha: true so this is fine
renderer.autoClearColor = true;
container.appendChild(renderer.domElement);

// ─── Lighting ───────────────────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0xffffff, 1.5));
const directionalLight = new THREE.DirectionalLight(0xffffff, 2);
directionalLight.position.set(5, 5, 5);
scene.add(directionalLight);
const pinkLight = new THREE.PointLight(0xff3e6d, 15, 50);
pinkLight.position.set(-5, -2, 2);
scene.add(pinkLight);

// ─── State ──────────────────────────────────────────────────────────────────
let model;
let memoriesData = [];
const loader       = new GLTFLoader();
const dracoLoader  = new DRACOLoader();
dracoLoader.setDecoderPath('https://unpkg.com/three@0.160.0/examples/jsm/libs/draco/');
loader.setDRACOLoader(dracoLoader);

const textureLoader            = new THREE.TextureLoader();
const loaderElement            = document.getElementById('loader');
const memorySectionsContainer  = document.getElementById('memory-sections-container');

const memoryGroups   = [];
const allSpiralPlanes = [];
const heartMeshes    = [];

let initialRotationY = Math.PI - 30;
let targetRotationY  = initialRotationY;
let currentRotationY = initialRotationY;
let targetHeartSpeed = 1;
let heartScrollOffset = 0;
let spinBoost = 0;

// Scroll state — updated by throttled listener, consumed by animation loop
let scrollProgress = 0;
let pendingSceneUpdate = false;  // dirty flag instead of calling updateScene() from scroll

// Active group tracking — separate from lastActiveIndex so video management
// re-runs whenever readiness changes, not just when index changes.
let activeGroupIndex = -1;

// Texture cache — prevents double-loading the same asset
const textureCache = new Map();

// ─── Init ────────────────────────────────────────────────────────────────────
async function init() {
    try {
        const response = await fetch('src/memories.json');
        memoriesData = await response.json();
        populateDOM();
        loadAssets();
    } catch (err) {
        console.error('Failed to initialize:', err);
    }
}

// ─── DOM ─────────────────────────────────────────────────────────────────────
function populateDOM() {
    const fragment = document.createDocumentFragment();
    memoriesData.forEach((item, index) => {
        const section = document.createElement('section');
        section.className = `memory-section ${index % 2 === 0 ? 'left' : 'right'}`;
        if (item.month !== 'Intro') {
            section.innerHTML = `
                <div class="anniversary-banner memory-banner">
                    <span class="sub-line">${item.month}</span>
                    <h1>${item.caption}</h1>
                    <div class="scroll-indicator">Keep scrolling ↓</div>
                </div>`;
        } else {
            section.classList.add('intro-spacer');
        }
        fragment.appendChild(section);
    });
    memorySectionsContainer.appendChild(fragment);
}

// ─── Asset Loading ────────────────────────────────────────────────────────────
function loadAssets() {
    loader.load('src/model.glb', (gltf) => {
        model = gltf.scene;
        const box    = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        model.position.x += (model.position.x - center.x);
        model.position.y += (model.position.y - center.y) - 0.5;
        model.userData.baseY = model.position.y;
        model.position.z += (model.position.z - center.z);
        const size   = box.getSize(new THREE.Vector3());
        const scale  = 3.5 / Math.max(size.x, size.y, size.z);
        model.scale.set(scale, scale, scale);
        model.rotation.y = initialRotationY;
        scene.add(model);

        createMemorySpirals();
        createFloatingHearts();

        ensureGroupLoaded(0);
        if (memoryGroups.length > 1) ensureGroupLoaded(1);

        updateScene();
        loaderElement.classList.add('hidden');
        animate();
    });
}

// ─── Hearts ───────────────────────────────────────────────────────────────────
function createFloatingHearts() {
    const heartShape = new THREE.Shape();
    const x = 0, y = 0;
    heartShape.moveTo(x + 5, y + 5);
    heartShape.bezierCurveTo(x + 5, y + 5, x + 4, y, x, y);
    heartShape.bezierCurveTo(x - 6, y, x - 6, y + 7, x - 6, y + 7);
    heartShape.bezierCurveTo(x - 6, y + 11, x - 3, y + 15.4, x + 5, y + 19);
    heartShape.bezierCurveTo(x + 12, y + 15.4, x + 16, y + 11, x + 16, y + 7);
    heartShape.bezierCurveTo(x + 16, y + 7, x + 16, y, x + 10, y);
    heartShape.bezierCurveTo(x + 7, y, x + 5, y + 5, x + 5, y + 5);

    const sharedGeometry = new THREE.ExtrudeGeometry(heartShape, {
        depth: 1, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: 1, bevelThickness: 1
    });
    const sharedMaterial = new THREE.MeshPhongMaterial({ color: 0xff3e6d, shininess: 100 });

    for (let i = 0; i < 10; i++) {
        const heart = new THREE.Mesh(sharedGeometry, sharedMaterial);
        heart.scale.set(0.02, 0.02, 0.02);
        heart.position.set(
            (Math.random() - 0.5) * 15,
            (Math.random() - 0.5) * 10 - 5,
            (Math.random() - 0.5) * 10 - 5
        );
        heart.userData.baseY = heart.position.y;
        heart.rotation.x = Math.PI;
        heart.userData.speed = Math.random() * 0.02 + 0.01;
        heart.userData.phase = Math.random() * Math.PI * 2;
        scene.add(heart);
        heartMeshes.push(heart);
    }
}

// ─── Spiral Memory Planes ─────────────────────────────────────────────────────
const sharedPlaneGeometry = new THREE.PlaneGeometry(1.2, 1.5);

/**
 * Convert 70vh into Three.js world units.
 * At z=0 with a PerspectiveCamera, the visible height = 2 * tan(fov/2) * dist.
 * We cap the spiral to 70% of that visible height so it always fits on screen.
 */
function getSpiralMaxHeight() {
    const fovRad  = (camera.fov * Math.PI) / 180;
    const dist    = camera.position.z; // planes sit near z=0, camera at z=5
    const vhWorld = 2 * Math.tan(fovRad / 2) * dist; // full visible height in world units
    return vhWorld * 0.70;
}

function createMemorySpirals() {
    let flatIdx = 0;
    const maxHeight = getSpiralMaxHeight();

    memoriesData.forEach((item, groupIndex) => {
        const group   = new THREE.Group();
        group.visible = false;

        const spacing   = Math.min(0.8, maxHeight / Math.max(item.images.length, 1));

        item.images.forEach((imgSrc, i) => {
            // Each plane gets its own material — shared geometry, unique material
            const material = new THREE.MeshBasicMaterial({
                transparent: true,
                opacity: 0,
                side: THREE.DoubleSide,
                // FIX: depthWrite false prevents z-fighting flicker during opacity fade
                depthWrite: false,
            });
            const plane = new THREE.Mesh(sharedPlaneGeometry, material);

            plane.userData.imageSrc      = imgSrc;
            plane.userData.textureLoaded = false;
            plane.userData.groupIndex    = groupIndex;
            plane.userData.flatIndex     = flatIdx;
            plane.userData.targetOpacity = 0;

            const angle    = (i / item.images.length) * Math.PI * 2;
            plane.position.x = Math.cos(angle) * 2.5;
            plane.position.z = Math.sin(angle) * 2.5;
            plane.position.y = ((item.images.length / 2) - i) * spacing;
            plane.lookAt(0, plane.position.y, 0);

            group.add(plane);
            allSpiralPlanes.push(plane);
            flatIdx++;
        });

        scene.add(group);
        memoryGroups.push(group);
    });
}

// ─── Texture / Video Loading ──────────────────────────────────────────────────
function ensureGroupLoaded(groupIndex) {
    const group = memoryGroups[groupIndex];
    if (!group) return;
    group.children.forEach(child => ensurePlaneLoaded(child.userData.flatIndex));
}

/**
 * Creates a <video> element optimised for use as a Three.js texture source.
 * Key flags:
 *   - muted + playsInline  → required for autoplay in browsers
 *   - preload='auto'       → buffer fully so playback is gapless
 *   - crossOrigin          → needed for WebGL texture upload
 */
function createVideoElement(src) {
    const video         = document.createElement('video');
    video.loop          = true;
    video.muted         = true;
    video.playsInline   = true;
    video.crossOrigin   = 'anonymous';
    video.preload       = 'auto';
    video.src           = src;
    video.style.display = 'none';
    document.body.appendChild(video);
    return video;
}

/**
 * Creates a VideoTexture with settings that prevent the common "green frame"
 * and pixelation artefacts:
 *   - LinearFilter on min AND mag → no mip interpolation glitches
 *   - generateMipmaps: false      → videos don't need/benefit from mipmaps
 *   - SRGBColorSpace              → correct gamma for most video content
 */
function createVideoTexture(video) {
    const texture = new THREE.VideoTexture(video);
    texture.minFilter      = THREE.LinearFilter;
    texture.magFilter      = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.colorSpace     = THREE.SRGBColorSpace;
    return texture;
}

function ensurePlaneLoaded(globalIndex) {
    if (globalIndex < 0 || globalIndex >= allSpiralPlanes.length) return;
    const plane = allSpiralPlanes[globalIndex];
    if (plane.userData.textureLoaded) return;
    plane.userData.textureLoaded = true;

    const imgSrc = plane.userData.imageSrc;
    if (!imgSrc) return;

    const isVideo = imgSrc.toLowerCase().endsWith('.mp4');

    if (isVideo) {
        // Check texture cache first
        if (textureCache.has(imgSrc)) {
            const { texture, video } = textureCache.get(imgSrc);
            plane.material.map         = texture;
            plane.material.needsUpdate = true;
            plane.userData.video       = video;
            plane.userData.videoReady  = !video.paused || video.readyState >= 4;
            return;
        }

        const video   = createVideoElement(imgSrc);
        const texture = createVideoTexture(video);

        plane.material.map         = texture;
        plane.material.needsUpdate = true;
        plane.userData.video       = video;
        plane.userData.videoReady  = false;

        textureCache.set(imgSrc, { texture, video });

        // Mark ready and trigger a scene update so opacity logic picks it up
        const onReady = () => {
            plane.userData.videoReady = true;
            pendingSceneUpdate = true; // processed next animation frame
        };

        if (video.readyState >= 4) {
            onReady();
        } else {
            video.addEventListener('canplaythrough', onReady, { once: true });
            video.load();
        }

    } else {
        // Image — use cache to avoid double-loading
        if (textureCache.has(imgSrc)) {
            plane.material.map          = textureCache.get(imgSrc);
            plane.material.needsUpdate  = true;
            plane.userData.textureReady = true;
            return;
        }

        textureLoader.load(imgSrc, (texture) => {
            // Optimise texture upload: disable auto-mipmap for photos
            texture.generateMipmaps = false;
            texture.minFilter       = THREE.LinearFilter;
            texture.colorSpace      = THREE.SRGBColorSpace;

            textureCache.set(imgSrc, texture);
            plane.material.map          = texture;
            plane.material.needsUpdate  = true;
            plane.userData.textureReady = true;
            pendingSceneUpdate = true;
        });
    }
}

// ─── Video Playback Management ────────────────────────────────────────────────
/**
 * Plays videos in the active ±1 range, pauses everything else.
 * Called every frame (cheap — just checks paused state).
 * Removed the lastActiveIndex guard so readiness changes are always handled.
 */
function manageVideos(newActiveIndex) {
    for (let gi = 0; gi < memoryGroups.length; gi++) {
        const inRange  = newActiveIndex >= 0 && Math.abs(gi - newActiveIndex) <= 1;
        const children = memoryGroups[gi].children;

        for (let j = 0; j < children.length; j++) {
            const child = children[j];
            const video = child.userData.video;
            if (!video) continue;

            if (inRange && child.userData.videoReady) {
                if (video.paused) video.play().catch(() => {});
            } else if (!inRange && !video.paused) {
                video.pause();
            }
        }
    }
    activeGroupIndex = newActiveIndex;
}

// ─── Scene Logic ──────────────────────────────────────────────────────────────
// Smooth opacity weight: 1.0 at centre, fades to 0 at ±0.5 via smoothstep.
// One group fully visible at a time; the OPACITY_LERP creates the cinematic dissolve.
function groupWeight(i, floatIndex) {
    const dist = Math.abs(floatIndex - i);
    if (dist >= 0.5) return 0;
    const t = 1.0 - (dist / 0.5); // 1 at centre, 0 at edge
    return t * t * (3 - 2 * t);    // smoothstep
}

function updateScene() {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    scrollProgress  = maxScroll > 0 ? Math.max(0, Math.min(1, window.scrollY / maxScroll)) : 0;

    const returnThreshold = 0.9;

    if (scrollProgress < returnThreshold) {
        const memoryProgress = scrollProgress / returnThreshold;
        targetRotationY = initialRotationY + memoryProgress * 15;
    } else {
        const returnProgress      = (scrollProgress - returnThreshold) / (1 - returnThreshold);
        const currentSpinRotation = initialRotationY + 15;
        targetRotationY = currentSpinRotation + (initialRotationY - currentSpinRotation) * returnProgress;
    }

    // Continuous float position through groups (0 → N-1)
    // Remapped so scrollProgress=returnThreshold lands exactly on the last group,
    // ensuring every group including April 2026 can reach full opacity.
    const memProgress  = Math.min(scrollProgress / returnThreshold, 1);
    const floatIndex   = memProgress * (memoriesData.length - 1);
    const nearestIndex = Math.round(floatIndex - 0.2); // bias slightly so intro lingers

    if (scrollProgress >= returnThreshold) {
        for (let i = 0; i < memoryGroups.length; i++) {
            const children = memoryGroups[i].children;
            for (let j = 0; j < children.length; j++) children[j].userData.targetOpacity = 0;
        }
        manageVideos(-1);
    } else {
        // Preload the visible group + both neighbours
        for (let offset = -1; offset <= 1; offset++) {
            const idx = nearestIndex + offset;
            if (idx >= 0 && idx < memoryGroups.length) ensureGroupLoaded(idx);
        }

        for (let i = 0; i < memoryGroups.length; i++) {
            const weight   = groupWeight(i, floatIndex);
            const group    = memoryGroups[i];
            const children = group.children;

            // Wake up the group's THREE visibility so the opacity lerp can run
            if (weight > 0 && !group.visible) group.visible = true;

            for (let j = 0; j < children.length; j++) {
                const child   = children[j];
                const isReady = child.userData.textureReady || child.userData.videoReady;
                // targetOpacity is the cross-faded weight — 0 when not ready or out of range
                child.userData.targetOpacity = isReady ? weight : 0;
            }
        }

        manageVideos(nearestIndex);
    }

    targetHeartSpeed  = 1 + scrollProgress * 5;
    heartScrollOffset = scrollProgress * 20;
}

// ─── Scroll Listener (rAF-throttled) ─────────────────────────────────────────
let scrollTicking = false;
window.addEventListener('scroll', () => {
    if (!scrollTicking) {
        requestAnimationFrame(() => {
            updateScene();
            scrollTicking = false;
        });
        scrollTicking = true;
    }
}, { passive: true });

// ─── Resize (rAF-throttled) ───────────────────────────────────────────────────
let resizeTicking = false;
window.addEventListener('resize', () => {
    if (!resizeTicking) {
        requestAnimationFrame(() => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
            resizeTicking = false;
        });
        resizeTicking = true;
    }
});

// ─── Animation Loop ───────────────────────────────────────────────────────────
/**
 * LERP speed constants — tuned for smoothness:
 *   MODEL_LERP   : slow, cinematic model rotation follow
 *   OPACITY_LERP : fast enough to feel snappy but not jarring on quick scroll
 */
const MODEL_LERP   = 0.05;
const OPACITY_LERP = 0.06; // slower → cinematic dissolve feel

function animate() {
    requestAnimationFrame(animate);

    // Apply any pending dirty scene update (e.g. texture finished loading)
    if (pendingSceneUpdate) {
        updateScene();
        pendingSceneUpdate = false;
    }

    if (!model) {
        renderer.render(scene, camera);
        return;
    }

    const now      = Date.now();
    const timeSlow = now * 0.001;
    const timeFast = now * 0.002;

    // ── Model ──
    currentRotationY += (targetRotationY - currentRotationY) * MODEL_LERP;
    if (spinBoost > 0.001) spinBoost *= 0.94; else spinBoost = 0;
    model.rotation.y   = currentRotationY + spinBoost;
    model.position.x   = Math.sin(currentRotationY * 0.5) * 0.2;
    model.position.y   = model.userData.baseY + Math.sin(timeSlow) * 0.08;

    // ── Memory spiral groups ──
    for (let i = 0; i < memoryGroups.length; i++) {
        const group = memoryGroups[i];

        // Skip groups that have never been made visible
        if (!group.visible) continue;

        group.rotation.y = currentRotationY * 0.8;

        const children  = group.children;
        let maxOpacity  = 0;

        for (let j = 0; j < children.length; j++) {
            const child  = children[j];
            const target = child.userData.targetOpacity || 0;
            const diff   = target - child.material.opacity;

            // Smooth lerp — but clamp tiny diffs to avoid endless micro-updates
            if (Math.abs(diff) > 0.004) {
                child.material.opacity += diff * OPACITY_LERP;
            } else {
                child.material.opacity = target;
            }

            if (child.material.opacity > maxOpacity) maxOpacity = child.material.opacity;
        }

        // Hide group when fully faded out to skip draw calls on next frame
        if (maxOpacity < 0.004) {
            group.visible = false;
        }
    }

    // ── Hearts ──
    for (let i = 0; i < heartMeshes.length; i++) {
        const heart = heartMeshes[i];
        heart.rotation.y  += heart.userData.speed * targetHeartSpeed;
        heart.position.y   = heart.userData.baseY + heartScrollOffset + Math.sin(timeSlow + heart.userData.phase) * 0.05;
        const pulse        = 0.02 + Math.sin(timeFast + heart.userData.phase) * 0.005;
        heart.scale.set(pulse, pulse, pulse);
    }

    renderer.render(scene, camera);
}

// ─── Intro Reveal ─────────────────────────────────────────────────────────────
const startButton   = document.getElementById('start-button');
const introOverlay  = document.getElementById('intro-overlay');
const music         = document.getElementById('anniversary-music');

if (startButton) {
    startButton.addEventListener('click', () => {
        music.play().catch(err => console.log('Audio play blocked:', err));

        if (memoryGroups.length > 0) {
            ensureGroupLoaded(0);
            memoryGroups[0].children.forEach(child => {
                const video = child.userData.video;
                if (!video) return;
                if (child.userData.videoReady) {
                    video.play().catch(() => {});
                } else {
                    video.addEventListener('canplaythrough', () => {
                        child.userData.videoReady = true;
                        video.play().catch(() => {});
                    }, { once: true });
                }
            });
        }

        spinBoost = Math.PI;
        introOverlay.classList.add('overlay-hidden');
        document.body.style.overflow = 'auto';
        window.scrollTo({ top: 0, behavior: 'instant' });
    });
}

init();