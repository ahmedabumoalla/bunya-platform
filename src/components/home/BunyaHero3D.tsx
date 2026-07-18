"use client";

import { useEffect, useRef } from "react";

const modelPath = "/models/bunya-logo-3d(1).glb";
const textureKeys = ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "alphaMap", "aoMap"] as const;
type TextureLike = { anisotropy: number; needsUpdate: boolean };
type TexturedMaterial = Partial<Record<(typeof textureKeys)[number], TextureLike | null>>;
type MeshObjectLike = {
  isMesh?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  material?: TexturedMaterial | TexturedMaterial[];
};

export default function BunyaHero3D() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let frameId = 0;
    let resizeObserver: ResizeObserver | null = null;
    let intersectionObserver: IntersectionObserver | null = null;
    let cleanupScene = () => {};

    const start = async () => {
      const [THREE, loaderModule] = await Promise.all([
        import("three"),
        import("three/examples/jsm/loaders/GLTFLoader.js"),
      ]);
      if (disposed) return;

      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const compactMotion = window.matchMedia("(max-width: 640px)").matches;
      const renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
        premultipliedAlpha: true,
      });
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.shadowMap.enabled = !compactMotion;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.domElement.className = "bunya-hero-3d-canvas";
      renderer.domElement.setAttribute("aria-hidden", "true");
      host.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
      camera.position.set(0, 0.12, 6.45);

      scene.add(new THREE.HemisphereLight(0xfff8ed, 0x8b654d, 2.5));
      const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
      keyLight.position.set(3, 4, 6);
      keyLight.castShadow = !compactMotion;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.camera.near = 0.1;
      keyLight.shadow.camera.far = 20;
      scene.add(keyLight);
      const rimLight = new THREE.DirectionalLight(0xd7a06f, 1.8);
      rimLight.position.set(-4, 1, 3);
      scene.add(rimLight);

      const modelRoot = new THREE.Group();
      scene.add(modelRoot);
      if (!compactMotion) {
        const shadowSurface = new THREE.Mesh(
          new THREE.PlaneGeometry(5, 5),
          new THREE.ShadowMaterial({ color: 0x5a4638, opacity: 0.12 }),
        );
        shadowSurface.rotation.x = -Math.PI / 2;
        shadowSurface.position.set(0, -1.55, 0);
        shadowSurface.receiveShadow = true;
        scene.add(shadowSurface);
      }
      let modelLoaded = false;
      let inView = true;
      let visible = !document.hidden;
      let animationElapsed = 0;
      let rotationY = 0;
      let lastFrameAt = 0;
      const rotationSpeed = compactMotion ? 0.12 : 0.192;

      const resize = () => {
        const width = Math.max(1, host.clientWidth);
        const height = Math.max(1, host.clientHeight);
        const dprCap = width <= 640 ? 1.75 : 2;
        const nextPixelRatio = Math.min(window.devicePixelRatio || 1, dprCap);
        if (renderer.getPixelRatio() !== nextPixelRatio) renderer.setPixelRatio(nextPixelRatio);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        if (modelLoaded) renderer.render(scene, camera);
      };

      const renderFrame = (time: number) => {
        frameId = 0;
        if (!modelLoaded || !visible || !inView) return;
        const delta = lastFrameAt ? Math.min((time - lastFrameAt) * 0.001, 0.05) : 0;
        lastFrameAt = time;
        if (!reduceMotion) {
          animationElapsed += delta;
          rotationY = (rotationY + delta * rotationSpeed) % (Math.PI * 2);
          const floatTarget = Math.sin(animationElapsed * (compactMotion ? 0.48 : 0.62)) * (compactMotion ? 0.035 : 0.065);
          modelRoot.position.y = THREE.MathUtils.damp(modelRoot.position.y, floatTarget, 8, delta);
          modelRoot.rotation.y = rotationY;
        }
        renderer.render(scene, camera);
        if (!reduceMotion) frameId = window.requestAnimationFrame(renderFrame);
      };

      const requestRender = () => {
        if (!frameId && visible && inView) frameId = window.requestAnimationFrame(renderFrame);
      };

      const loader = new loaderModule.GLTFLoader();
      loader.load(
        modelPath,
        // The runtime loader is intentionally isolated from the application type graph.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (gltf: any) => {
          if (disposed) return;
          const model = gltf.scene;
          const box = new THREE.Box3().setFromObject(model);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          const largest = Math.max(size.x, size.y, size.z) || 1;
          const scale = 3.8 / largest;
          const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
          const anisotropy = Math.min(maxAnisotropy, compactMotion ? 4 : 8);
          model.position.sub(center);
          model.scale.multiplyScalar(scale);
          model.traverse((object: MeshObjectLike) => {
            const mesh = object;
            if (!mesh.isMesh) return;
            mesh.castShadow = !compactMotion;
            mesh.receiveShadow = false;
            const materials: Array<TexturedMaterial | undefined> = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.forEach((material) => {
              if (!material) return;
              textureKeys.forEach((key) => {
                const texture = material[key];
                if (!texture) return;
                texture.anisotropy = anisotropy;
                texture.needsUpdate = true;
              });
            });
          });
          modelRoot.add(model);
          modelLoaded = true;
          host.dataset.loaded = "true";
          resize();
          requestRender();
        },
        undefined,
        () => {
          host.dataset.failed = "true";
        },
      );

      const onVisibilityChange = () => {
        visible = !document.hidden;
        if (!visible && frameId) {
          window.cancelAnimationFrame(frameId);
          frameId = 0;
          lastFrameAt = 0;
        } else {
          requestRender();
        }
      };

      document.addEventListener("visibilitychange", onVisibilityChange);
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(host);
      intersectionObserver = new IntersectionObserver(([entry]) => {
        inView = entry?.isIntersecting ?? false;
        if (!inView && frameId) {
          window.cancelAnimationFrame(frameId);
          frameId = 0;
          lastFrameAt = 0;
        } else {
          requestRender();
        }
      }, { rootMargin: "80px" });
      intersectionObserver.observe(host);
      resize();

      cleanupScene = () => {
        document.removeEventListener("visibilitychange", onVisibilityChange);
        if (frameId) window.cancelAnimationFrame(frameId);
        scene.traverse((object: { geometry?: { dispose: () => void }; material?: { dispose?: () => void } | Array<{ dispose?: () => void }> }) => {
          object.geometry?.dispose();
          if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose?.());
          else object.material?.dispose?.();
        });
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      };
    };

    start().catch(() => {
      host.dataset.failed = "true";
    });

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      cleanupScene();
    };
  }, []);

  return <div className="bunya-hero-3d" aria-hidden="true" ref={hostRef} />;
}
