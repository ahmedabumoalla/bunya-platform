"use client";

import Image from "next/image";
import { useCallback, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import styles from "./BunyaLogoIntro.module.css";

let introPlayedInDocument = false;

export function BunyaLogoIntro() {
  const [visible, setVisible] = useState(() => {
    if (typeof document === "undefined") return true;
    return !introPlayedInDocument && document.documentElement.dataset.bunyaIntroPlayed !== "true";
  });
  const overlayRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const squaresRef = useRef<HTMLDivElement>(null);
  const square1Ref = useRef<HTMLImageElement>(null);
  const square2Ref = useRef<HTMLImageElement>(null);
  const square3Ref = useRef<HTMLImageElement>(null);
  const wordRef = useRef<HTMLImageElement>(null);
  const taglineRef = useRef<HTMLImageElement>(null);
  const skipRef = useRef<HTMLButtonElement>(null);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);
  const previousOverflowRef = useRef<string | null>(null);
  const finishedRef = useRef(false);
  const homeTargetsRef = useRef<HTMLElement[]>([]);

  const restorePage = useCallback(() => {
    if (previousOverflowRef.current !== null) {
      document.body.style.overflow = previousOverflowRef.current;
      previousOverflowRef.current = null;
    }
    if (homeTargetsRef.current.length) {
      gsap.set(homeTargetsRef.current, { clearProps: "opacity,visibility,transform,will-change" });
    }
  }, []);

  const finishIntro = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    introPlayedInDocument = true;
    document.documentElement.dataset.bunyaIntroPlayed = "true";
    restorePage();
    timelineRef.current?.kill();
    timelineRef.current = null;
    setVisible(false);
  }, [restorePage]);

  useGSAP(() => {
    if (!visible) return;
    const overlay = overlayRef.current;
    const stage = stageRef.current;
    const squares = squaresRef.current;
    const square1 = square1Ref.current;
    const square2 = square2Ref.current;
    const square3 = square3Ref.current;
    const word = wordRef.current;
    const tagline = taglineRef.current;
    const skip = skipRef.current;
    if (!overlay || !stage || !squares || !square1 || !square2 || !square3 || !word || !tagline || !skip) {
      finishIntro();
      return;
    }

    try {
      introPlayedInDocument = true;
      document.documentElement.dataset.bunyaIntroPlayed = "true";
      previousOverflowRef.current = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      homeTargetsRef.current = Array.from(document.querySelectorAll<HTMLElement>(".store-header, .store-intro-copy"));
      const layers = [square1, square2, square3, word, tagline];
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    gsap.set(layers, { autoAlpha: 0 });
    gsap.set([stage, squares, ...layers], { willChange: "transform,opacity,filter" });
    gsap.set(homeTargetsRef.current, { autoAlpha: 0.65, y: 10, willChange: "transform,opacity" });

    const timeline = gsap.timeline({
      defaults: { overwrite: "auto" },
      onComplete: finishIntro,
    });
    timelineRef.current = timeline;

    if (reduceMotion) {
      timeline
        .set(layers, { autoAlpha: 1, filter: "blur(0px)", xPercent: 0, yPercent: 0, rotation: 0, scale: 1 })
        .to({}, { duration: 0.35 })
        .to(homeTargetsRef.current, { autoAlpha: 1, y: 0, duration: 0.22, ease: "power1.out" }, 0.35)
        .to(overlay, { autoAlpha: 0, duration: 0.24, ease: "power1.out" }, 0.35)
        .set([stage, squares, ...layers, ...homeTargetsRef.current], { clearProps: "will-change" });
    } else {
      timeline
        .fromTo(square1, { xPercent: -55, yPercent: 35, rotation: -18, scale: 0.86, autoAlpha: 0, filter: "blur(10px)" }, { xPercent: 0, yPercent: 0, rotation: 0, scale: 1, autoAlpha: 1, filter: "blur(0px)", duration: 0.82, ease: "expo.out" }, 0)
        .fromTo(square2, { yPercent: -70, rotation: 12, scale: 0.88, autoAlpha: 0, filter: "blur(10px)" }, { yPercent: 0, rotation: 0, scale: 1, autoAlpha: 1, filter: "blur(0px)", duration: 0.8, ease: "power3.out" }, 0.1)
        .fromTo(square3, { xPercent: 60, yPercent: -35, rotation: 16, scale: 0.86, autoAlpha: 0, filter: "blur(10px)" }, { xPercent: 0, yPercent: 0, rotation: 0, scale: 1, autoAlpha: 1, filter: "blur(0px)", duration: 0.84, ease: "expo.out" }, 0.16)
        .fromTo(word, { autoAlpha: 0, yPercent: 12, scale: 0.98, filter: "blur(8px)" }, { autoAlpha: 1, yPercent: 0, scale: 1, filter: "blur(0px)", duration: 0.55, ease: "power3.out" }, 0.72)
        .to(squares, { scale: 1.025, duration: 0.11, ease: "power2.out" }, 1.03)
        .to(squares, { scale: 1, duration: 0.11, ease: "power2.inOut" }, 1.14)
        .fromTo(tagline, { autoAlpha: 0, yPercent: 25, filter: "blur(6px)" }, { autoAlpha: 1, yPercent: 0, filter: "blur(0px)", duration: 0.42, ease: "power2.out" }, 1.22)
        .to(skip, { autoAlpha: 1, pointerEvents: "auto", duration: 0.2, ease: "power1.out" }, 0.35)
        .to({}, { duration: 0.3 }, 1.64)
        .to(stage, { scale: 0.92, yPercent: -6, duration: 0.62, ease: "power3.inOut" }, 1.94)
        .to(homeTargetsRef.current, { autoAlpha: 1, y: 0, duration: 0.56, ease: "power3.out" }, 1.94)
        .to(overlay, { clipPath: "polygon(0 0, 100% 0, 100% 0, 0 0)", duration: 0.62, ease: "power3.inOut" }, 1.94)
        .set([stage, squares, ...layers, ...homeTargetsRef.current], { clearProps: "will-change" });
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") timeline.timeScale(6).play();
    };
    window.addEventListener("keydown", onKeyDown);

      return () => {
        window.removeEventListener("keydown", onKeyDown);
        timeline.kill();
        timelineRef.current = null;
        restorePage();
      };
    } catch (error: unknown) {
      console.warn("Bunya logo intro skipped after an animation error.", error);
      finishIntro();
    }
  }, { scope: overlayRef, dependencies: [finishIntro, restorePage, visible] });

  if (!visible) return null;

  const failSafely = () => finishIntro();
  const skip = () => timelineRef.current?.timeScale(6).play();

  return (
    <div aria-label="شاشة افتتاحية لبُنية" className={styles.overlay} data-bunya-intro ref={overlayRef}>
      <button className={styles.skip} onClick={skip} ref={skipRef} type="button">تخطي</button>
      <div className={styles.stage} data-bunya-intro-stage ref={stageRef}>
        <div className={styles.squares} ref={squaresRef}>
          <Image alt="" className={`${styles.layer} ${styles.square1}`} draggable={false} height={252} onError={failSafely} priority ref={square1Ref} sizes="(max-width: 700px) 22vw, 255px" src="/brand/intro/square-1.png" width={431} />
          <Image alt="" className={`${styles.layer} ${styles.square3}`} draggable={false} height={252} onError={failSafely} priority ref={square3Ref} sizes="(max-width: 700px) 22vw, 255px" src="/brand/intro/square-3.png" width={427} />
          <Image alt="" className={`${styles.layer} ${styles.square2}`} draggable={false} height={257} onError={failSafely} priority ref={square2Ref} sizes="(max-width: 700px) 22vw, 255px" src="/brand/intro/square-2.png" width={426} />
        </div>
        <Image alt="" className={`${styles.layer} ${styles.word}`} draggable={false} height={344} onError={failSafely} priority ref={wordRef} sizes="(max-width: 700px) 48vw, 555px" src="/brand/intro/word.png" width={936} />
        <Image alt="" className={`${styles.layer} ${styles.tagline}`} draggable={false} height={69} onError={failSafely} priority ref={taglineRef} sizes="(max-width: 700px) 47vw, 543px" src="/brand/intro/tagline.png" width={916} />
      </div>
    </div>
  );
}
