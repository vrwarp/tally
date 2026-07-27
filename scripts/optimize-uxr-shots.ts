/**
 * Shrinks the before/after frames into web-sized JPEGs for the walkthrough.
 *
 * Only the `-fold` frames: the comparison is about what a person can see
 * without scrolling, which is the whole argument of the refinement, and a
 * full-page frame is a 3,000px strip nobody can drag a slider across.
 *
 * Node has no image codec and adding one for a documentation build is a poor
 * trade, so this delegates to Pillow the way `optimize-screenshots.ts` already
 * does.
 *
 *   npx tsx scripts/optimize-uxr-shots.ts
 */
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const PROGRAM = `
import glob, os
from PIL import Image

# The two halves have to come out the same pixel size or the slider reveals a
# shifted image rather than a changed one.
TARGET = {"desktop": 1240, "phone": 460}

for side in ("before", "after"):
    src = f"uxr/renders/{side}"
    out = f"docs/uxr/{side}"
    os.makedirs(out, exist_ok=True)
    for path in sorted(glob.glob(f"{src}/*-fold.png")):
        name = os.path.basename(path)
        stem = name[: -len("-fold.png")]
        viewport = "desktop" if stem.endswith("--desktop") else "phone"
        image = Image.open(path).convert("RGB")
        width = TARGET[viewport]
        height = round(image.size[1] * width / image.size[0])
        image = image.resize((width, height), Image.LANCZOS)
        image.save(f"{out}/{stem}.jpg", "JPEG", quality=82, optimize=True, progressive=True)
        print(f"{side}/{stem}.jpg  {width}x{height}")
`;

await mkdir('docs/uxr', { recursive: true });
const output = execFileSync('python3', ['-c', PROGRAM], { encoding: 'utf8' });
process.stdout.write(output);
