"use client";

import { useEffect, useRef } from "react";

const modelPath = "/models/bunya-logo-3d(1).glb";

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
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
      renderer.setClearColor(0x000000, 0);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, compactMotion ? 1 : 1.35));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.domElement.className = "bunya-hero-3d-canvas";
      renderer.domElement.setAttribute("aria-hidden", "true");
      host.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 100);
      camera.position.set(0, 0.15, 6.6);

      scene.add(new THREE.HemisphereLight(0xfff8ed, 0x8b654d, 2.5));
      const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
      keyLight.position.set(3, 4, 6);
      scene.add(keyLight);
      const rimLight = new THREE.DirectionalLight(0xd7a06f, 1.8);
      rimLight.position.set(-4, 1, 3);
      scene.add(rimLight);

      const modelRoot = new THREE.Group();
      scene.add(modelRoot);
      let modelLoaded = false;
      let inView = true;
      let visible = !document.hidden;
      let animationStartedAt = 0;

      const resize = () => {
        const width = Math.max(1, host.clientWidth);
        const height = Math.max(1, host.clientHeight);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        if (modelLoaded) renderer.render(scene, camera);
      };

      const renderFrame = (time: number) => {
        frameId = 0;
        if (!modelLoaded || !visible || !inView) return;
        const seconds = Math.max(0, time - animationStartedAt) * 0.001;
        if (!reduceMotion) {
          modelRoot.position.y = Math.sin(seconds * (compactMotion ? 0.48 : 0.62)) * (compactMotion ? 0.035 : 0.065);
          modelRoot.rotation.y = (seconds * (compactMotion ? 0.1 : 0.16)) % (Math.PI * 2);
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
          model.position.sub(center);
          model.scale.multiplyScalar(scale);
          model.traverse((object: { isMesh?: boolean; castShadow?: boolean; receiveShadow?: boolean }) => {
            if (object.isMesh) {
              object.castShadow = false;
              object.receiveShadow = false;
            }
          });
          modelRoot.add(model);
          modelLoaded = true;
          animationStartedAt = performance.now();
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
