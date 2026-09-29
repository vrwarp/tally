/**
 * One lobby kiosk, as Tally can speak of it: what it is called, what it is
 * doing, what it still holds, and what the core team may do about it.
 *
 * Shared by the Kiosk page's list and the Team page's person panel, so the two
 * cannot say different things about the same tablet. Everything here is read
 * from the device row, which is core-only — so is every screen that draws one.
 *
 * What it can say about a tablet it cannot see is inference, and said as such
 * (docs/kiosk-offline-recovery.md §7): a kiosk last heard from while set to a
 * gathering is almost always one whose lobby lost the internet, still recording
 * on its own storage; and when it next sends, the callable writes what is still
 * on it, so the row can say *12 check-ins waiting* and, afterwards, *All in
 * Tally since …*.
 */
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { Button, TextField } from '@/components/ui';
import { useAuth } from '@/context/authContext';
import { useToast } from '@/context/toastContext';
import { useTimeFormats } from '@/hooks/useTimeFormats';
import { KIOSK_NAME_MAX, kioskName } from '@/lib/kioskName';
import {
  isKioskLive,
  kioskAllInSince,
  kioskLabel,
  kioskMayHoldRecords,
  kioskOutOfTouchSince,
  kioskWaitingCount,
  renameKioskDevice,
  retireKioskDevice,
} from '@/services/kioskDevices';
import type { KioskDevice } from '@/types';

export interface KioskDeviceRowProps {
  device: KioskDevice;
  now: Date;
  /** The Kiosk page lists everybody's kiosks and says who paired each; a person's panel does not need to. */
  showPairedBy?: boolean;
}

export function KioskDeviceRow({ device, now, showPairedBy = false }: KioskDeviceRowProps) {
  const t = useTranslations('Team');
  const tCommon = useTranslations('Common');
  const time = useTimeFormats();
  const { profile, can } = useAuth();
  const { show } = useToast();

  const uid = profile?.id ?? '';
  const nowMs = now.getTime();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');

  const live = isKioskLive(device, nowMs);
  const quietSince = kioskOutOfTouchSince(device, nowMs);
  const label = kioskLabel(device);

  /** The clock on the day itself, the date on any other — as the rest of this screen writes a moment. */
  const when = (date: Date) =>
    date.toDateString() === now.toDateString() ? time.clock(date) : time.weekdayDate(date);

  const waiting = kioskWaitingCount(device);
  const allInAt = kioskAllInSince(device, nowMs);

  const retire = async () => {
    setArmed(false);
    setBusy(true);
    try {
      await retireKioskDevice(device.id, uid);
      // No Undo, and the toast says what happens instead of leaving a gap
      // where one usually is: the rules refuse un-retiring, because the row is
      // the provenance of every morning that kiosk recorded.
      show(t('kioskRetiredToast', { device: label }), { tone: 'success' });
    } catch {
      show(t('retireKioskFailed'), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const startRename = () => {
    setDraft(device.name ?? '');
    setRenaming(true);
  };

  const saveName = async () => {
    setBusy(true);
    try {
      await renameKioskDevice(device.id, draft);
      const name = kioskName(draft);
      show(
        name === null
          ? t('kioskNameRemovedToast', { device: device.id })
          : t('kioskRenamedToast', { name }),
        { tone: 'success' },
      );
      setRenaming(false);
    } catch {
      show(t('renameKioskFailed'), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const status = device.retiredAt
    ? t('kioskRetiredOn', { when: time.weekdayDate(device.retiredAt) })
    : live
      ? t('kioskLive', { gathering: device.boundTo ?? '' })
      : quietSince
        ? t('kioskOutOfTouch', { when: when(quietSince), gathering: device.boundTo ?? '' })
        : t('kioskIdle', { when: device.pairedAt ? time.weekdayDate(device.pairedAt) : '' });

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-ink-100" title={device.name ? device.id : undefined}>
          {label}
        </span>
        {showPairedBy && device.approvedByName ? (
          <span className="block text-xs text-ink-500">
            {t('kioskPairedBy', { name: device.approvedByName })}
          </span>
        ) : null}
        {/*
          A bound kiosk that stopped reporting used to read "not recording",
          which was the one thing it almost certainly was still doing: a tablet
          whose lobby lost the internet keeps taking check-ins on its own
          storage, and the report that would say so is the thing that cannot
          land. Said as it is, with the time Tally last heard from it.
        */}
        <span className={`block text-xs ${quietSince ? 'text-warn-400' : 'text-ink-400'}`}>{status}</span>
        {/*
          What it told Tally the last time it sent — the callable writes the
          count on every call, so it cannot go stale while the tablet can
          reach Tally, and while it cannot, it says what it last knew.
        */}
        {waiting > 0 ? (
          <span className="block text-xs text-warn-400">
            {t('kioskWaitingOnTablet', {
              count: waiting,
              when: device.waitingSinceAt ? when(device.waitingSinceAt) : '',
            })}
          </span>
        ) : allInAt ? (
          <span className="block text-xs text-present-400">
            {t('kioskAllInSince', { when: when(allInAt) })}
          </span>
        ) : null}
        {/*
          Said only when it is worth saying. A shelf tablet lives on mains, so
          "87%, charging" is a fact nobody can act on and one more line on a
          screen that is already dense — but a kiosk running on its battery
          means somebody unplugged it, and that is worth finding out before
          Sunday rather than during. A retired row says nothing: it is not
          expected to be anywhere.
        */}
        {!device.retiredAt && device.charging === false && device.batteryLevel != null && (
          <span className="block text-xs text-warn-400">
            {t('kioskOffCharger', { percent: Math.round(device.batteryLevel * 100) })}
          </span>
        )}
      </span>

      {device.retiredAt || renaming ? null : armed ? (
        <span className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setArmed(false)}>
            {t('keepItRunning')}
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void retire()}>
            {t('yesRetire')}
          </Button>
        </span>
      ) : (
        <span className="flex items-center gap-2">
          {can('core') ? (
            <Button variant="ghost" disabled={busy} onClick={startRename}>
              {device.name ? t('renameKiosk') : t('nameKiosk')}
            </Button>
          ) : null}
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => (kioskMayHoldRecords(device, nowMs) ? setArmed(true) : void retire())}
          >
            {t('retireKiosk')}
          </Button>
        </span>
      )}

      {/* The consequence on its own line inside the row, the shape Withdraw
          already uses: short, because the row is shrink-to-fit in the tablet
          band and a long sentence sets its width. */}
      {armed ? (
        <p role="alert" className="basis-full text-xs text-ink-400">
          {live
            ? t('retireLiveWarning', { gathering: device.boundTo ?? '' })
            : quietSince
              ? t('retireOutOfTouchWarning', { gathering: device.boundTo ?? '' })
              : t('retireWaitingWarning', { count: device.waitingCount ?? 0 })}
        </p>
      ) : null}

      {renaming ? (
        <form
          className="flex basis-full flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            void saveName();
          }}
        >
          <TextField
            className="min-w-0 flex-1"
            label={t('kioskNameLabel')}
            hint={t('kioskNameHint', { device: device.id })}
            value={draft}
            maxLength={KIOSK_NAME_MAX}
            autoComplete="off"
            onChange={(event) => setDraft(event.target.value)}
          />
          <span className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => setRenaming(false)} disabled={busy}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" loading={busy}>
              {t('saveKioskName')}
            </Button>
          </span>
        </form>
      ) : null}
    </li>
  );
}
