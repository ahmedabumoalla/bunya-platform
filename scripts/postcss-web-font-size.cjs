// Apply the same additive increase to authored CSS and generated Tailwind sizes.
// Keep the root size unchanged so rem-based spacing and breakpoints do not grow.
module.exports = () => ({
  postcssPlugin: "bunya-web-font-size",
  OnceExit(root) {
    root.walkDecls("font-size", (declaration) => {
      const value = declaration.value;
      if (value.includes("--bunya-web-font-increase")) return;
      if (/^(?:0(?:px|rem|em)?|inherit|initial|unset|revert(?:-layer)?)$/.test(value)) return;

      // Relative sizes already inherit part of the parent's increase.
      const relative = value.match(/^([\d.]+)(em|%)$/);
      if (relative) {
        const ratio = Number(relative[1]) / (relative[2] === "%" ? 100 : 1);
        declaration.value = `calc(${value} + var(--bunya-web-font-increase, 0px) * ${1 - ratio})`;
      } else if (/^(?:[\d.]+(?:px|rem|vw|vh)|(?:clamp|min|max|calc|var)\()/.test(value)) {
        declaration.value = `calc(${value} + var(--bunya-web-font-increase, 0px))`;
      }
    });
  },
});
module.exports.postcss = true;
