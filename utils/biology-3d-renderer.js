const http = require('http');
const path = require('path');
const fs = require('fs').promises;
const { chromium } = require('playwright');
const { Logger } = require('./logger');

class Biology3DRenderer {
  constructor() {
    this.logger = new Logger('Biology3DRenderer');
    this.root = path.join(__dirname, '..');
    this.threePath = path.join(path.dirname(require.resolve('three')), 'three.module.js');
    this.scenePath = path.join(this.root, 'assets', '3d', 'biology-scene.js');
  }

  createSceneHTML() {
    return `<!doctype html>
<html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;overflow:hidden;background:#062c2a;color:#f4e8cc;font-family:Arial,sans-serif}
#stage{position:absolute;inset:0}#overlay{position:absolute;inset:0;padding:42px 48px;pointer-events:none}
#kicker{color:#35d6cf;font-size:18px;font-weight:800;letter-spacing:.2em}#visual-title{width:72%;margin:12px 0 0;font:700 40px/1.08 Georgia,serif}
#labels{position:absolute;right:42px;top:70px;width:330px;margin:0;padding:18px 22px;list-style:none;background:rgba(2,26,25,.82);border:1px solid rgba(53,214,207,.5)}
#labels li{display:flex;gap:12px;align-items:center;margin:10px 0;font-size:18px;line-height:1.25}#labels span{display:grid;place-items:center;width:27px;height:27px;border-radius:50%;background:#ffd54a;color:#062c2a;font-weight:800;flex:0 0 auto}
#relationship{position:absolute;left:48px;bottom:70px;max-width:780px;padding:13px 18px;border-left:5px solid #f36b21;background:rgba(2,26,25,.78);font-size:21px;font-weight:700}
#limitation{position:absolute;right:42px;bottom:28px;max-width:500px;color:#f4e8cc;font-size:13px;opacity:.8;text-align:right}
#badge{position:absolute;left:48px;bottom:22px;color:#ffd54a;font-size:12px;font-weight:800;letter-spacing:.14em}
</style></head><body><div id="stage"></div><div id="overlay"><div id="kicker">BLAIZE TUTORS · 3D CONCEPT MODEL</div><h1 id="visual-title"></h1><ul id="labels"></ul><div id="relationship"></div><div id="badge">SCHEMATIC MODEL · VERIFY LABELS · NOT TO SCALE</div><div id="limitation"></div></div><script type="module" src="/biology-scene.js"></script></body></html>`;
  }

  async startServer() {
    const html = this.createSceneHTML();
    const server = http.createServer(async (request, response) => {
      try {
        if (request.url === '/three.module.js' || request.url === '/three.core.js') {
          response.writeHead(200, { 'Content-Type': 'text/javascript' });
          const threeFile = request.url === '/three.core.js'
            ? path.join(path.dirname(this.threePath), 'three.core.js')
            : this.threePath;
          response.end(await fs.readFile(threeFile));
        } else if (request.url === '/biology-scene.js') {
          response.writeHead(200, { 'Content-Type': 'text/javascript' });
          response.end(await fs.readFile(this.scenePath));
        } else {
          response.writeHead(200, { 'Content-Type': 'text/html' });
          response.end(html);
        }
      } catch (error) {
        response.writeHead(500, { 'Content-Type': 'text/plain' });
        response.end(error.message);
      }
    });

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    return { server, port: server.address().port };
  }

  async renderSectionClips(sections, outputDir, clipSeconds = 5) {
    await fs.mkdir(outputDir, { recursive: true });
    const { server, port } = await this.startServer();
    const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-webgl'] });
    const clips = [];

    try {
      for (let index = 0; index < sections.length; index++) {
        const visualSpec = sections[index].visualSpec;
        if (!visualSpec?.template) throw new Error(`Section ${index + 1} has no 3D visual template`);

        this.logger.info(`Rendering 3D Biology scene ${index + 1}/${sections.length}: ${visualSpec.template}`);
        const videoDir = path.join(outputDir, `capture_${index}`);
        await fs.mkdir(videoDir, { recursive: true });
        const context = await browser.newContext({
          viewport: { width: 1280, height: 720 },
          recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } }
        });
        const page = await context.newPage();
        await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
        await page.waitForFunction(() => window.__biology3dReady === true);
        await page.evaluate(spec => window.configureScene(spec), visualSpec);

        const steps = Math.max(20, Math.round(clipSeconds * 10));
        for (let frame = 0; frame <= steps; frame++) {
          await page.evaluate(progress => window.setProgress(progress), frame / steps);
          await page.waitForTimeout((clipSeconds * 1000) / steps);
        }

        const video = page.video();
        await context.close();
        const clipPath = path.join(outputDir, `section_${String(index).padStart(2, '0')}.webm`);
        await video.saveAs(clipPath);
        clips.push({ path: clipPath, duration: Math.max(15, Number(sections[index].duration) || 60) });
        await fs.rm(videoDir, { recursive: true, force: true });
      }
      return clips;
    } finally {
      await browser.close().catch(() => {});
      await new Promise(resolve => server.close(resolve));
    }
  }
}

module.exports = { Biology3DRenderer };
