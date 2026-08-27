/**
 * The event editor's two kiosk fields — the colours and the photograph —
 * mounted from `src/` the way `uxr/kiosk-live` mounts the kiosk's screens:
 * real components, props off the query string, no prototype to drift.
 *
 * The photograph runs the *real* upload pipeline: the demo scene is fetched
 * as a blob and pushed through `prepareKioskBackdrop` — decode, downscale,
 * re-encode, hash — so the frame under review shows what the compressor
 * actually says and the preview crops what the canvas actually produced.
 * Nothing is stubbed except the save, which never happens here.
 *
 * The one requirement on the server: `--mode emulated`, so `@/lib/firebase`
 * (reached through the field's save-time service import) initializes against
 * the demo config instead of demanding a real one. Nothing here ever calls
 * it — a `new` photograph is uploaded at event save, and this page has no
 * save.
 *
 *   ?photo=1        run the demo scene through the pipeline and hold it chosen
 *   ?ground=light   the gathering's theme on its light ground
 */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@/index.css';
import {
  KioskBackdropField,
  type KioskBackdropChoice,
} from '@/features/events/KioskBackdropField';
import { KioskThemeField } from '@/features/events/KioskThemeField';
import { prepareKioskBackdrop } from '@/lib/backdropImage';
import { DEFAULT_KIOSK_THEME, type KioskTheme } from '@/lib/kioskTheme';

const params = new URLSearchParams(location.search);

export function EditorFields() {
  const [theme, setTheme] = useState<KioskTheme | null>(
    params.get('ground') === 'light' ? { ...DEFAULT_KIOSK_THEME, ground: 'light' } : null,
  );
  const [value, setValue] = useState<KioskBackdropChoice>({ kind: 'none' });
  const [ready, setReady] = useState(params.get('photo') !== '1');

  useEffect(() => {
    if (params.get('photo') !== '1') return;
    void fetch('/uxr/kiosk-live/backdrop-demo.svg')
      .then((response) => response.blob())
      .then((blob) => prepareKioskBackdrop(blob))
      .then((prepared) => {
        setValue({ kind: 'new', prepared });
        setReady(true);
      });
  }, []);

  // Nothing paints until the pipeline has answered, so the shooter's
  // networkidle wait cannot photograph a field mid-compression.
  if (!ready) return null;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 p-8" data-editor-ready="1">
      <KioskThemeField value={theme} onChange={setTheme} />
      <KioskBackdropField value={value} theme={theme} onChange={setValue} />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<EditorFields />);
