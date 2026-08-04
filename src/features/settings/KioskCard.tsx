/**
 * The lobby kiosk, from the core team's side: where to pair one, and the
 * button that rebuilds its search-by-phone index on demand.
 *
 * The index rebuilds itself nightly and whenever a kiosk finds it stale, so
 * the button exists for exactly one moment: a family's number was just fixed
 * upstream and they are standing at the kiosk now.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, CardHeader } from '@/components/ui';
import { useToast } from '@/context/toastContext';
import { refreshKioskPhoneIndex } from '@/services/functions';

export function KioskCard() {
  const { show } = useToast();
  const [rebuilding, setRebuilding] = useState(false);

  const rebuild = async () => {
    if (rebuilding) return;
    setRebuilding(true);
    try {
      const { data } = await refreshKioskPhoneIndex({ force: true });
      show(`Phone search rebuilt: ${data.students} students, ${data.entries} number endings.`, {
        tone: 'success',
      });
    } catch {
      show('Could not rebuild the kiosk phone index. Is a people backend reachable?', {
        tone: 'error',
      });
    } finally {
      setRebuilding(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Check-in kiosk"
        description="A self-serve check-in screen for a device in the lobby, served at /kiosk on this same site."
      />
      <div className="flex flex-col gap-3 px-4 py-3">
        <p className="text-sm text-ink-400">
          On the kiosk device, open <span className="font-mono text-ink-300">/kiosk</span> — it
          shows a pairing code. Approve the code from{' '}
          <Link to="/pair-kiosk" className="font-medium text-brand-300 underline">
            Pair a kiosk
          </Link>{' '}
          (any team member can), then hold the button to bind it to a gathering. Families check
          themselves in by name or by the last four digits of any phone number in the household;
          only those four digits are ever stored in Tally.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => void rebuild()} loading={rebuilding}>
            Rebuild phone search index
          </Button>
          <span className="text-xs text-ink-500">
            Rebuilds nightly on its own; use this when a family&apos;s number changed today.
          </span>
        </div>
      </div>
    </Card>
  );
}
