/**
 * The event page's quiet summary of the lobby kiosk, for the core team — one
 * line, not a badge on every row (docs/kiosk-offline-recovery.md §7).
 *
 * - **While a kiosk set to this gathering is quiet** on its day: when it was
 *   last heard from, and that what was checked in there since is still on the
 *   tablet — the count the register is missing is not a count of children who
 *   did not come.
 * - **Afterwards**, from the register itself: how many records reached Tally
 *   late, and when the last one did — or, while the kiosk is still sending,
 *   how many so far.
 * - **Records it parked** for this gathering, with the way to Review, where
 *   they are settled.
 *
 * The rule for "quiet on this gathering's day" is `quietOn`, shared with the
 * counselors' register so the two cannot tell different stories. Device rows
 * and parked records are core-only, and so is this page.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useTranslations } from 'use-intl';
import { useTimeFormats } from '@/hooks/useTimeFormats';
import { lateFromKiosks, quietOn } from '@/lib/kioskQuiet';
import { chainKey } from '@/lib/materialize';
import { subscribeKioskDevices, kioskWaitingCount } from '@/services/kioskDevices';
import { parkedCards, subscribeUnsettledParkedRecords, type KioskParkedRecord } from '@/services/kioskParkedRecords';
import type { AttendanceRecord, KioskDevice, TallyEvent } from '@/types';

const BOX = 'rounded-xl bg-ink-950 px-3 py-2 text-sm ring-1 ring-ink-800';

export function KioskEventLine({
  event,
  attendance,
  now,
}: {
  event: TallyEvent;
  attendance: readonly AttendanceRecord[];
  now: Date;
}) {
  const t = useTranslations('EventDetail');
  const time = useTimeFormats();
  const [devices, setDevices] = useState<KioskDevice[]>([]);
  const [parked, setParked] = useState<KioskParkedRecord[]>([]);

  // A refusal or a failure is simply no line: this is a summary, and the
  // register above it is the fact.
  useEffect(() => subscribeKioskDevices(setDevices, () => setDevices([])), []);
  useEffect(() => subscribeUnsettledParkedRecords(setParked, () => setParked([])), []);

  const when = (date: Date) =>
    date.toDateString() === now.toDateString() ? time.clock(date) : time.weekdayDate(date);
  const called = (device: Pick<KioskDevice, 'name'> | undefined) => ({
    named: device?.name ? 'yes' : 'no',
    kiosk: device?.name ?? '',
  });

  const chain = chainKey(event);
  const quiet = devices.filter(
    (device) => !device.retiredAt && device.boundChain === chain && quietOn(device.lastSeenAt, event, now.getTime()),
  );
  const late = useMemo(() => lateFromKiosks(attendance), [attendance]);
  const cards = useMemo(
    () => parkedCards(parked.filter((record) => record.eventId === event.id)),
    [parked, event.id],
  );

  const lines: ReactElement[] = quiet.map((device) => (
    <p key={`quiet:${device.id}`} className={`${BOX} text-warn-400`}>
      {t('kioskQuiet', { ...called(device), when: when(device.lastSeenAt!) })}
    </p>
  ));
  if (quiet.length === 0) {
    for (const each of late) {
      const device = devices.find((candidate) => candidate.id === each.deviceId);
      const sending = device !== undefined && kioskWaitingCount(device) > 0;
      lines.push(
        <p key={`late:${each.deviceId}`} className={`${BOX} text-ink-300`}>
          {sending
            ? t('kioskLateSending', { ...called(device), count: each.count })
            : t('kioskLate', { ...called(device), count: each.count, when: when(each.allInAt) })}
        </p>,
      );
    }
  }
  if (cards.length > 0) {
    lines.push(
      <p key="parked" className={`${BOX} text-ink-300`}>
        {t('kioskParked', { count: cards.length })}{' '}
        <Link to="/review" className="font-semibold text-brand-300 hover:text-brand-200">
          {t('kioskParkedLink')}
        </Link>
      </p>,
    );
  }

  return lines.length === 0 ? null : <div className="flex flex-col gap-2">{lines}</div>;
}
