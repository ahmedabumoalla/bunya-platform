import { expect, test, type Page } from "@playwright/test";

const publicRoutes = [
  "/",
  "/contractors",
  "/login",
  "/register",
  "/providers/join",
  "/contractors/join",
  "/privacy",
  "/terms",
  "/account-deletion",
] as const;

async function auditRoute(page: Page, route: string) {
  const response = await page.goto(route, { waitUntil: "load" });
  expect(response?.status(), `${route} did not load successfully`).toBeLessThan(400);
  await page.waitForTimeout(250);

  const audit = await page.evaluate(() => {
    const visible = (element: Element) => {
      const rectangle = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rectangle.width > 0 && rectangle.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    return {
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      headings: [...document.querySelectorAll("h1")].filter(visible).length,
      bodyTextLength: document.body.innerText.trim().length,
      brokenImages: [...document.images].filter((image) => image.complete && image.naturalWidth === 0).length,
      unnamedButtons: [...document.querySelectorAll("button")].filter((button) => {
        if (!visible(button)) return false;
        return !(button.textContent?.trim() || button.getAttribute("aria-label") || button.getAttribute("title"));
      }).length,
    };
  });

  expect(audit.overflow, `${route} has horizontal overflow`).toBeFalsy();
  expect(audit.headings, `${route} has no visible primary heading`).toBeGreaterThan(0);
  expect(audit.bodyTextLength, `${route} rendered no meaningful content`).toBeGreaterThan(100);
  expect(audit.brokenImages, `${route} contains broken images`).toBe(0);
  expect(audit.unnamedButtons, `${route} contains unnamed buttons`).toBe(0);
}

test("public surfaces remain readable on desktop and mobile", async ({ page }) => {
  const consoleErrors: string[] = [];
  const serverErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) serverErrors.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const route of publicRoutes) await auditRoute(page, route);
  }

  expect(consoleErrors).toEqual([]);
  expect(serverErrors).toEqual([]);
});

test("mobile interactive controls meet the minimum touch target", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ["/", "/login", "/register", "/providers/join", "/contractors/join"]) {
    await page.goto(route, { waitUntil: "load" });
    await page.waitForTimeout(250);
    const undersized = await page.evaluate(() => {
      const controls = [...document.querySelectorAll<HTMLElement>("button,input,select,textarea")];
      return controls.flatMap((element) => {
        const rectangle = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const input = element instanceof HTMLInputElement ? element.type : "";
        if (
          rectangle.width === 0 ||
          rectangle.height === 0 ||
          style.visibility === "hidden" ||
          style.display === "none" ||
          style.opacity === "0" ||
          input === "checkbox" ||
          input === "radio" ||
          input === "file"
        ) return [];
        // Chromium may report an exact 44 CSS px target as 43.99998 after scaling.
        return rectangle.height < 43.5
          ? [{ tag: element.tagName, label: (element.textContent || element.getAttribute("aria-label") || "").trim(), height: rectangle.height }]
          : [];
      });
    });
    expect(undersized, `${route} has undersized touch controls: ${JSON.stringify(undersized)}`).toEqual([]);

    if (route.endsWith("/join")) {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(100);
      const languageSwitcherOverlapsSubmit = await page.evaluate(() => {
        const floating = document.querySelector<HTMLElement>('[class*="floating"]');
        const submit = document.querySelector<HTMLButtonElement>('button[type="submit"]');
        if (!floating || !submit) return false;
        const left = floating.getBoundingClientRect();
        const right = submit.getBoundingClientRect();
        return !(left.right < right.left || left.left > right.right || left.bottom < right.top || left.top > right.bottom);
      });
      expect(languageSwitcherOverlapsSubmit, `${route} language switcher obstructs submit`).toBeFalsy();
    }
  }
});

test("every supported language keeps the storefront readable and correctly directed", async ({ page }) => {
  const locales = [
    { code: "ar", direction: "rtl" },
    { code: "en", direction: "ltr" },
    { code: "ur", direction: "rtl" },
    { code: "hi", direction: "ltr" },
    { code: "bn", direction: "ltr" },
    { code: "fil", direction: "ltr" },
  ] as const;

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const locale of locales) {
      await page.context().addCookies([{
        name: "bunya_locale",
        value: locale.code,
        url: "http://127.0.0.1:3110",
      }]);
      await page.goto("/", { waitUntil: "load" });
      await expect(page.locator("html")).toHaveAttribute("lang", locale.code);
      await expect(page.locator("html")).toHaveAttribute("dir", locale.direction);
      await auditRoute(page, "/");
    }
  }
});
