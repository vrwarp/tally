/**
 * The register's one line about the lobby kiosk.
 *
 * When a kiosk set to this gathering goes quiet on its day, the check-ins and
 * pickups made there since are on the tablet, not on this list — and the
 * counselor holding the list is the one who needs to know that a child wearing
 * today's name tag was checked in (docs/kiosk-offline-recovery.md §7). No
 * counts: the owner chose the smaller option for counselors. Nothing at all
 * while every kiosk is reporting, or if the copy it reads is late or refused —
 * this is help, never a reason to draw an error on the register.
 *
 * Reads `kioskPresence/{chain}`, the one-way copy of the device rows that
 * anybody on the gathering may read, and judges it with the same rule the
 * event page uses (`quietOn`), so the two cannot tell different stories.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { useTimeFormats } from '@/hooks/useTimeFormats';
import { quietOn } from '@/lib/kioskQuiet';
import { chainKey } from '@/lib/materialize';
import { subscribeKioskPresence, type KioskPresence } from '@/services/kioskPresence';
import type { TallyEvent } from '@/types';

export function QuietKiosks({ event, now }: { event: TallyEvent; now: Date }) {
  const t = useTranslations('CheckIn');
  const time = useTimeFormats();
  const chain = chainKey(event);
  const [presence, setPresence] = useState<KioskPresence[]>([]);

  useEffect(() => subscribeKioskPresence(chain, setPresence), [chain]);

  const quiet = presence.filter((kiosk) => quietOn(kiosk.lastSeenAt, event, now.getTime()));
  if (quiet.length === 0) return null;

  return (
    <div role="status" className="mt-2 flex flex-col gap-2">
      {quiet.map((kiosk) => (
        <p
          key={kiosk.deviceId}
          className="rounded-xl bg-warn-500/10 px-3 py-2 text-sm text-ink-200 ring-1 ring-warn-500/30"
        >
          {t('kioskQuiet', {
            named: kiosk.name ? 'yes' : 'no',
            kiosk: kiosk.name ?? '',
            when:
              kiosk.lastSeenAt!.toDateString() === now.toDateString()
                ? time.clock(kiosk.lastSeenAt!)
                : time.weekdayDate(kiosk.lastSeenAt!),
          })}
        </p>
      ))}
    </div>
  );
}
