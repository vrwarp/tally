/**
 * The other end of the lobby kiosk: its records that no retry could land,
 * each waiting for somebody with Tally open to decide
 * (docs/kiosk-offline-recovery.md §5).
 *
 * One card per child and gathering — an arrival and the pickup parked with it
 * are one decision — oldest tap first. Each card says why it is here in
 * Review's grammar, a sentence above every control saying what the press does:
 *
 * - **Record** only when the server would take it: a frozen child whose record
 *   is back. Until then the card links the child's page, where the repair is,
 *   or — for a child deleted upstream, who has no page — offers the
 *   re-creation itself (`putBackAs`).
 * - **Let it go** always, kept as a decision with the settler's name on it —
 *   never an absence.
 *
 * Settling happens on the server (`settleParkedKioskRecord`), which re-checks
 * everything this screen inferred; its answer is what the toast says.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslations } from 'use-intl';
import { Badge, Button, Card, CardHeader } from '@/components/ui';
import { useData } from '@/context/dataContext';
import { useToast } from '@/context/toastContext';
import { useServerText } from '@/hooks/useServerText';
import { useTimeFormats } from '@/hooks/useTimeFormats';
import type { SettleDecision, SettleStatus } from '@/lib/kioskSettle';
import { recreatePlanningCenterPerson, settleParkedKioskRecord } from '@/services/functions';
import {
  cardAnswer,
  cardReason,
  parkedCards,
  putBackAs,
  standingStudent,
  subscribeUnsettledParkedRecords,
  type KioskParkedRecord,
  type KioskParkedStudent,
  type ParkedCard,
} from '@/services/kioskParkedRecords';
import { subscribeStudents } from '@/services/students';
import { BACKEND_LABELS, type Student } from '@/types';

const CAPTION = 'text-sm text-ink-400 lg:text-xs';
const STRIP = 'rounded-xl bg-ink-800/50 px-3 py-2 text-sm text-ink-300 ring-1 ring-ink-700';

/** A sentence, then the control — the Review page's decision, above rather than below. */
function Decision({ caption, children }: { caption: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-1.5">
      <p className={CAPTION}>{caption}</p>
      {children}
    </div>
  );
}

export function KioskParkedSection() {
  const t = useTranslations('Review');
  const { show } = useToast();
  const serverText = useServerText();
  const { students, refreshRoster } = useData();
  const [records, setRecords] = useState<KioskParkedRecord[] | null>(null);
  const [documents, setDocuments] = useState<Student[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(
    () =>
      subscribeUnsettledParkedRecords(
        (rows) => {
          setFailed(false);
          setRecords(rows);
        },
        () => setFailed(true),
      ),
    [],
  );

  /*
   * Tally's own student documents, which the cards walk as the server does
   * (`standingStudent`). The data provider's own query, so the client serves
   * it from the watch it already holds. Until it answers, or if refused, the
   * roster stands in.
   */
  useEffect(() => subscribeStudents(setDocuments, () => setDocuments(null)), []);

  const cards = useMemo(() => parkedCards(records ?? []), [records]);
  const studentsById = useMemo(() => new Map(students.map((student) => [student.id, student])), [students]);
  const documentsById = useMemo(
    () => (documents === null ? studentsById : new Map(documents.map((student) => [student.id, student]))),
    [documents, studentsById],
  );

  const settle = async (card: ParkedCard, decision: SettleDecision) => {
    if (busy) return;
    setBusy(card.id);
    try {
      const { data } = await settleParkedKioskRecord({ id: card.id, decision });
      const said: Record<SettleStatus, string> = {
        settled: decision === 'record' ? t('parkedRecordedToast') : t('parkedLetGoToast'),
        'already-settled': t('parkedAlreadySettled'),
        'still-frozen': t('parkedStillFrozen'),
        'cannot-record': t('parkedCannotRecord'),
        'not-found': t('parkedNotFound'),
      };
      show(said[data.status], { tone: data.status === 'settled' ? 'success' : 'error' });
    } catch {
      show(t('actionFailed'), { tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  // The same call, and the same answers, as the repair on a student's page.
  const putBack = async (card: ParkedCard, studentId: string, as: KioskParkedStudent) => {
    if (busy) return;
    setBusy(card.id);
    const name = `${as.firstName} ${as.lastName}`;
    try {
      const { data } = await recreatePlanningCenterPerson({
        studentId,
        firstName: as.firstName,
        lastName: as.lastName,
        ...(as.grade === null ? {} : { grade: as.grade }),
      });
      const back = data.status === 'recreated' || data.status === 'relinked' || data.status === 'still-there';
      show(data.message, { tone: back ? 'success' : 'info' });
      // The roster must be asked again for the new person's name. Not
      // awaited: a roster failure is its own banner, not this call's.
      if (back) void refreshRoster(true);
    } catch (cause) {
      show(serverText(cause, t('parkedPutBackFailed', { name, backend: BACKEND_LABELS.pco })), { tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  // Nothing at all while nothing waits: this section is for the rare morning
  // an outage left something behind, not a standing heading over an empty list.
  if (failed) return <p className="text-sm text-warn-400">{t('parkedNotLoaded')}</p>;
  if (cards.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <header>
        <h2 className="flex items-center gap-2 text-base font-semibold text-ink-100">
          {t('parkedHeading')}
          <Badge tone="neutral">{cards.length}</Badge>
        </h2>
        <p className="mt-0.5 max-w-2xl text-sm text-ink-500">{t('parkedIntro')}</p>
      </header>
      <div className="flex flex-col gap-4 lg:block lg:columns-2 lg:gap-8">
        {cards.map((card) => (
          <ParkedCardView
            key={card.id}
            card={card}
            studentsById={studentsById}
            documentsById={documentsById}
            busy={busy === card.id}
            disabled={busy !== null}
            onSettle={(decision) => void settle(card, decision)}
            onPutBack={(studentId, as) => void putBack(card, studentId, as)}
          />
        ))}
      </div>
    </section>
  );
}

function ParkedCardView({
  card,
  studentsById,
  documentsById,
  busy,
  disabled,
  onSettle,
  onPutBack,
}: {
  card: ParkedCard;
  /** The roster's rows: names, and whether a child has a page to link. */
  studentsById: ReadonlyMap<string, Student>;
  /** Tally's own documents: what happened to a child, as the server reads it. */
  documentsById: ReadonlyMap<string, Student>;
  busy: boolean;
  disabled: boolean;
  onSettle: (decision: SettleDecision) => void;
  onPutBack: (studentId: string, as: KioskParkedStudent) => void;
}) {
  const t = useTranslations('Review');
  const time = useTimeFormats();
  const { events } = useData();

  const standing = standingStudent(card.studentId, documentsById);
  const row = standing ? studentsById.get(standing.id) : undefined;
  const known = card.arrival?.student ?? card.pickup?.student ?? null;
  const name = row
    ? `${row.firstName} ${row.lastName}`
    : known
      ? `${known.firstName} ${known.lastName}`
      : t('parkedSomeChild');
  const event = events.find((each) => each.id === card.eventId);
  const gathering = event?.title ?? card.arrival?.gathering ?? card.pickup?.gathering ?? t('parkedSomeGathering');
  const firstTap = card.arrival?.tappedAt ?? card.pickup?.tappedAt ?? null;
  const clock = (record: KioskParkedRecord | null) =>
    record?.tappedAt ? time.clock(record.tappedAt) : t('parkedTimeNotKnown');
  const taps = {
    arrival: clock(card.arrival),
    pickup: clock(card.pickup),
    kinds: card.arrival && card.pickup ? 'both' : card.arrival ? 'arrival' : 'pickup',
  };

  const reason = cardReason(card);
  const answer = cardAnswer(card, documentsById);
  const putBack = putBackAs(card, standing, row !== undefined);
  const why = (() => {
    switch (reason) {
      case 'frozen':
        return answer === 'record'
          ? t('parkedFrozenBack', { name, ...taps })
          : t('parkedFrozen', { name, ...taps });
      case 'gathering-deleted':
        return t('parkedGatheringDeleted', { name, ...taps });
      case 'no-arrival':
        return t('parkedNoArrival', {
          name,
          date: firstTap ? time.weekdayDate(firstTap) : t('parkedTimeNotKnown'),
          pickup: taps.pickup,
        });
      case 'arrival-parked':
        return t('parkedArrivalLetGo', { pickup: taps.pickup });
      default:
        return t('parkedUnreadable');
    }
  })();

  return (
    <Card className="break-inside-avoid lg:mb-8">
      <CardHeader
        title={name}
        description={firstTap ? t('parkedWhere', { gathering, date: time.weekdayDate(firstTap) }) : gathering}
      />
      <div className="flex flex-col gap-3 p-3">
        <p className={STRIP}>{why}</p>
        {answer === 'frozen' && row ? (
          <Link
            to={`/students/${row.id}`}
            className="self-start text-sm font-semibold text-brand-300 hover:text-brand-200"
          >
            {t('parkedOpenStudent', { name })}
          </Link>
        ) : null}
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2">
          {answer === 'record' ? (
            <Decision caption={t('parkedRecordCaption', { gathering })}>
              <Button
                className="mt-auto min-h-12 w-full lg:w-auto"
                loading={busy}
                disabled={disabled}
                onClick={() => onSettle('record')}
              >
                {t('parkedRecord', taps)}
              </Button>
            </Decision>
          ) : putBack ? (
            <Decision caption={t('parkedPutBackCaption', { backend: BACKEND_LABELS.pco })}>
              <Button
                className="mt-auto min-h-12 w-full lg:w-auto"
                loading={busy}
                disabled={disabled}
                onClick={() => onPutBack(putBack.studentId, putBack.name)}
              >
                {t('parkedPutBack', { name, backend: BACKEND_LABELS.pco })}
              </Button>
            </Decision>
          ) : null}
          <Decision caption={t('parkedLetGoCaption')}>
            <Button
              variant="secondary"
              className="mt-auto min-h-12 w-full lg:w-auto"
              loading={busy && answer !== 'record' && !putBack}
              disabled={disabled}
              onClick={() => onSettle('let-go')}
            >
              {t('parkedLetGo')}
            </Button>
          </Decision>
        </div>
      </div>
    </Card>
  );
}
