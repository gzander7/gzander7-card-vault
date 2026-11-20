// Renders the PNG app icons in icons/ from favicon.svg. Run after changing the
// logo: `node scripts/make-icons.mjs` (needs the Playwright browser).
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const svg = await readFile(new URL('../favicon.svg', import.meta.url), 'utf8');
const logo = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
const icons = [
  // Full-bleed icons keep the logo's own frame.
  { file: 'icon-192.png', size: 192, inset: 0 },
  { file: 'icon-512.png', size: 512, inset: 0 },
  { file: 'apple-touch-icon.png', size: 180, inset: 0.08 },
  // Maskable icons keep the logo inside the central 80% safe zone.
  { file: 'icon-maskable-512.png', size: 512, inset: 0.14 },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const { file, size, inset } of icons) {
  await page.setViewportSize({ width: size, height: size });
  const pad = Math.round(size * inset);
  await page.setContent(
    `<body style="margin:0;background:${inset ? '#30151b' : 'transparent'}">` +
      `<img src="${logo}" style="display:block;width:${size - 2 * pad}px;height:${size - 2 * pad}px;margin:${pad}px"></body>`,
  );
  await page.screenshot({ path: new URL(`../icons/${file}`, import.meta.url).pathname, omitBackground: !inset });
  console.log(`icons/${file}`);
}
await browser.close();
