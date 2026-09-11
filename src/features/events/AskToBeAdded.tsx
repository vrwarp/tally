/**
 * The one button on a gathering somebody is not on.
 *
 * Deliberately not a workflow, and the copy carries most of that decision.
 * Nothing is notified, nothing waits on it, and nobody is obliged to answer —
 * so the words never say "request", "pending", "asked" or anything shaped like
 * a status, because a status is a promise the design does not make. What the
 * sentence after the press says instead is what actually happened and what to
 * do with your feet: your name is on a list, the people who can act on it will
 * see it when they open this roster, and if they are not here, go and find
 * them. That last clause is not a consolation; on most Friday evenings it *is*
 * the path, and the ask only makes the last step one tap instead of a search.
 *
 * **A clear is not silence.** The row the asker gets back after somebody
 * answers says who cleared it and when, because without that they cannot tell
 * "nobody has looked" from "somebody has said no" — and the second one, read
 * as the first, is how a person ends up pressing again next week instead of
 * walking across the lobby.
 */
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui';
import { useAuth } from '@/context/authContext';
import { useToast } from '@/context/toastContext';
import { fullName, useTeam } from '@/features/events/useTeam';
import { useChainRequests } from '@/features/events/useAccessRequests';
import { askToBeAdded } from '@/services/accessRequests';
import { useTimeFormats } from '@/hooks/useTimeFormats';
import { useLocale, useTranslations } from 'use-intl';
import type { UserProfile } from '@/types';

export interface AskToBeAddedProps {
  /** The chain being asked about. Null while the caller has not resolved one. */
  chain: string | null;
  /**
   * Who would see the ask, already ranked by the caller — the same people it
   * has just named on the screen above. The sentence says them back, so the
   * person pressing knows exactly whose roster their name lands on.
   */
  approvers: readonly UserProfile[];
  /** The screen is on this gathering, so the listener is worth opening. */
  enabled?: boolean;
}

export function AskToBeAdded({ chain, approvers, enabled = true }: AskToBeAddedProps) {
  const t = useTranslations('Access');
  const locale = useLocale();
  const time = useTimeFormats();
  const { profile } = useAuth();
  const { show } = useToast();
  const { byUid } = useTeam(enabled);
  const { mine } = useChainRequests(chain, enabled);
  const [busy, setBusy] = useState(false);

  if (!chain || !profile) return null;

  const names = new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(
    approvers.map(fullName),
  );

  const press = async () => {
    setBusy(true);
    try {
      await askToBeAdded(chain, profile.id, fullName(profile));
      show(approvers.length > 0 ? t('asked', { names }) : t('askedNobodyNamed'), {
        tone: 'success',
      });
    } catch {
      show(t('askFailed'), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  /*
   * Answered. The button goes — pressing it again would write the same
   * document and say the same thing, which is the app pretending the answer
   * has not happened — and what stands in its place is who answered and when.
   */
  if (mine?.clearedAt) {
    const who = mine.clearedBy ? byUid.get(mine.clearedBy) : undefined;
    const when = time.clock(mine.clearedAt);
    return (
      <Standing>
        <p className="text-sm text-ink-200">
          {who
            ? t('askCleared', { name: fullName(who), when })
            : t('askClearedNoName', { when })}
        </p>
      </Standing>
    );
  }

  /*
   * What the reader's own press did, said with the standing of an outcome.
   *
   * It used to be one grey line set exactly like the boilerplate above it —
   * "Your name is on the Add list." — naming nobody and dated to nothing,
   * which is the shape of a status, and a status is a promise this design does
   * not make. So: when it happened, then who will see it and where, then that
   * nothing is queued and the walk is still the path.
   */
  if (mine) {
    return (
      <Standing>
        <p className="text-sm font-semibold text-ink-100">
          {/* Undated only where the write has not come back from the server
              yet — the local snapshot has no `askedAt` for that one beat. */}
          {mine.askedAt
            ? t('askedAlready', { when: time.relative(mine.askedAt) })
            : t('askedAlreadyUndated')}
        </p>
        <p className="max-w-[62ch] pt-0.5 text-sm leading-snug text-ink-400">
          {approvers.length > 0 ? t('askedWaitingNamed', { names }) : t('askedWaitingNobody')}
        </p>
      </Standing>
    );
  }

  return (
    <div className="pt-3">
      <Button variant="secondary" loading={busy} onClick={() => void press()}>
        {t('askToBeAdded')}
      </Button>
    </div>
  );
}

/**
 * A rule and some air, so the outcome is not a fourth item of the directory
 * above it. The list is about other people; this is about the reader.
 */
function Standing({ children }: { children: ReactNode }) {
  return <div className="mt-3 border-t border-ink-800 pt-3">{children}</div>;
}
