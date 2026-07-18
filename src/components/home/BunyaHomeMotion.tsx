"use client";

import type { RefObject } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(useGSAP, ScrollTrigger);

export function BunyaHomeMotion({
  scope,
  filterKey,
  detailOpen,
}: {
  scope: RefObject<HTMLElement | null>;
  filterKey: string;
  detailOpen: boolean;
}) {
  useGSAP(() => {
    const root = scope.current;
    if (!root) return;
    const heroTargets = root.querySelectorAll<HTMLElement>(".store-hero-logo, [data-hero-motion]");
    const sections = Array.from(root.querySelectorAll<HTMLElement>("[data-gsap-section]")).slice(0, 2);
    const categoryCards = root.querySelectorAll<HTMLElement>(".store-category-chip, .store-latest-card");
    const categorySection = root.querySelector<HTMLElement>("#categories");
    const mm = gsap.matchMedia();
    mm.add({ reduce: "(prefers-reduced-motion: reduce)", mobile: "(max-width: 700px)" }, (context) => {
      if (context.conditions?.reduce) {
        gsap.set([...heroTargets, ...categoryCards], { clearProps: "all" });
        return;
      }
      const distance = context.conditions?.mobile ? 12 : 22;
      const heroTimeline = gsap.timeline({ defaults: { ease: "power2.out" } });
      if (heroTargets.length) heroTimeline.from(heroTargets, { autoAlpha: 0, y: distance, duration: 0.48, stagger: 0.07 });
      sections.forEach((section) => {
        gsap.from(section, {
          autoAlpha: 0,
          y: 24,
          duration: 0.58,
          scrollTrigger: { trigger: section, start: "top 88%", once: true },
        });
      });
      if (categoryCards.length && categorySection) gsap.from(categoryCards, {
        autoAlpha: 0,
        y: 12,
        duration: 0.38,
        stagger: 0.035,
        scrollTrigger: { trigger: categorySection, start: "top 86%", once: true },
      });
    });
    return () => mm.revert();
  }, { dependencies: [] });

  useGSAP(() => {
    const root = scope.current;
    if (!root) return;
    const cards = root.querySelectorAll<HTMLElement>(".store-product-grid .store-stagger-card");
    if (!cards.length) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.fromTo(cards, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.28, stagger: 0.025, clearProps: "all" });
  }, { dependencies: [filterKey] });

  useGSAP(() => {
    const root = scope.current;
    if (!root) return;
    const panel = root.querySelector<HTMLElement>(".store-detail-panel");
    if (!panel) return;
    if (!detailOpen || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.fromTo(panel, { autoAlpha: 0, y: 18, scale: 0.985 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.34, ease: "power2.out", clearProps: "transform" });
  }, { dependencies: [detailOpen] });

  return null;
}
