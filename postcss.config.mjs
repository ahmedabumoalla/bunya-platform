import path from "node:path";

const config = {
  plugins: {
    "@tailwindcss/postcss": {},
    [path.join(process.cwd(), "scripts/postcss-web-font-size.cjs")]: {},
  },
};

export default config;
