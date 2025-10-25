import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main(){
  const projectRoot = path.resolve(__dirname, '..');
  const outPath = path.join(projectRoot, 'flier.img');
  const targetUrl = 'file://' + path.join(projectRoot, 'flier.html');

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    const container = await page.$('.container');
    if (container) {
      const clip = await container.boundingBox();
      if (clip) {
        await page.screenshot({ path: outPath, clip: { x: Math.max(0, clip.x - 8), y: Math.max(0, clip.y - 8), width: Math.min(clip.width + 16, 10000), height: Math.min(clip.height + 16, 10000) } });
      } else {
        await page.screenshot({ path: outPath, fullPage: true });
      }
    } else {
      await page.screenshot({ path: outPath, fullPage: true });
    }
    console.log('Saved flier to', outPath);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });


