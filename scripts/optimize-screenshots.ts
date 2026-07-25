/**
 * Shrinks the captured PNGs into web-sized JPEGs.
 *
 * The raw screenshots are ~4 MB, which is fine in the repository but far too
 * much to embed in a single shareable page. These are the copies the HTML
 * inlines as data URIs; the PNGs stay as the archival originals.
 */
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const SHOTS = 'docs/walkthrough/shots';
const WEB = 'docs/walkthrough/web';

/**
 * Node has no image codec, and adding one for a documentation build is a poor
 * trade. Pillow is already available wherever the screenshots are captured, so
 * the resize is delegated to a short Python program rather than a dependency.
 */
const PROGRAM = `
import glob, os, sys
from PIL import Image

os.makedirs("${WEB}", exist_ok=True)
for path in sorted(glob.glob("${SHOTS}/*.png")):
    name = os.path.basename(path)
    image = Image.open(path).convert("RGB")
    width, height = image.size
    # Desktop shots carry more detail and get more pixels; phone shots are
    # displayed narrow, so they need far fewer.
    target = 760 if name.startswith("desktop") else 380
    if width > target:
        image = image.resize((target, round(height * target / width)), Image.LANCZOS)
    image.save(os.path.join("${WEB}", name[:-4] + ".jpg"), "JPEG",
               quality=72, optimize=True, progressive=True)
print("optimised", len(glob.glob("${SHOTS}/*.png")), "screenshots")
`;

const { spawn } = await import('node:child_process');

await mkdir(WEB, { recursive: true });
const files = await readdir(SHOTS).catch(() => [] as string[]);
if (files.length === 0) {
  throw new Error(`No screenshots in ${SHOTS}. Run \`npm run walkthrough:capture\` first.`);
}

await new Promise<void>((resolve, reject) => {
  const child = spawn('python3', ['-c', PROGRAM], { stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', (code) =>
    code === 0
      ? resolve()
      : reject(
          new Error(
            `Image optimisation failed (exit ${code}). It needs Pillow: pip install Pillow`,
          ),
        ),
  );
});

// Report the saving, because the whole point is fitting inside one page.
const sum = async (dir: string, ext: string) => {
  const names = (await readdir(dir)).filter((name) => name.endsWith(ext));
  const sizes = await Promise.all(names.map(async (name) => (await readFile(join(dir, name))).length));
  return sizes.reduce((total, size) => total + size, 0);
};

const before = await sum(SHOTS, '.png');
const after = await sum(WEB, '.jpg');
console.log(
  `  ${(before / 1e6).toFixed(2)} MB of PNGs -> ${(after / 1e6).toFixed(2)} MB of JPEGs`,
);
