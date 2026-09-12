/**
 * A staff member binding the kiosk to one gathering.
 *
 * The event is chosen by a person, never by the clock — the same product rule
 * as the main app's chooser. The gathering whose check-in window is open is
 * ringed and sorted first, but somebody still has to pick it.
 *
 * The hold is on the rows, and only on the rows: holding a gathering sets the
 * kiosk to it outright, so the usual setup is one gesture rather than a tap and
 * then a second press somewhere else on the screen. Tapping a row only selects,
 * which is what keeps a scrolling thumb from re-pointing anything.
 *
 * The button below the list is a plain tap. It was a hold too, and two holds to
 * do one thing was the kiosk asking twice: a volunteer who has already picked a
 * row on a screen headed "Which gathering is this kiosk for?" has said which
 * one, out loud, on the only screen where that question is asked — and the
 * press guard already means the finger has to come off inside the button. The
 * accident the hold was written against is the *other* path, a hand brushing a
 * row on the way past, and that path still holds. What the button lost with it
 * is the word "hold", which is why the subtitle under the question says the
 * rows' gesture in as many words; it is the only place it is written down.
 *
 * Today, plus whatever is open — the same list the app's own chooser offers,
 * in the same words, for the same reason. The server sends the week because
 * `getKioskEvents` is also what materialises an occurrence nobody has created
 * yet, and because a window that opened yesterday has to survive the calendar
 * boundary; what a volunteer may actually point a tablet at is narrower than
 * that. It used to be the whole week, and a thumb one row off on a list of
 * identically-titled Wednesdays pointed a lobby screen at the wrong one — after
 * which it took an evening's register against a gathering that had not
 * happened, silently, because nothing downstream checks a check-in against a
 * clock.
 *
 * Narrowed here rather than in the callable, and that is the one part of this
 * worth arguing about. "Today" is a fact about the room the tablet is standing
 * in, and only the tablet knows it: the function runs in UTC, so an evening
 * gathering in the Americas is already tomorrow as far as the server is
 * concerned, and a horizon cut server-side would drop exactly the gathering the
 * kiosk is being set up for. The client has the church's own clock. The
 * refusal in `KioskApp.onConfirm` is what covers everything this cannot — a
 * binding made yesterday, a tablet left on overnight, a clock that drifted.
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import { EventName } from "../components/EventName";
import { HoldButton } from "../components/HoldButton";
import { InstallPrompt } from "../components/InstallPrompt";
import { useTap } from "../components/tapGuard";
import type { KioskEventEntry, KioskServices } from "../KioskApp";
import type { KioskBinding } from "../binding";
import type { PrinterState } from "../printing";
import { usePrinterNote } from "../printerNote";
import { useLocale, useTranslations } from "use-intl";

function dayLabel(locale: string, startAtMs: number, nowMs: number): string {
  const start = new Date(startAtMs);
  const today = new Date(nowMs);
  const sameDay = start.toDateString() === today.toDateString();
  if (sameDay) return "Today";
  /*
   * `short`, and the difference is one line on a phone.
   *
   * Nearly every row on this list says "Today" — it is narrowed to today, plus
   * whatever is still open — so the dated row is the gathering left running
   * from last night, and it is the only row where this string has to share a
   * line with a full time range. "Wednesday, Aug 12" did not fit and took the
   * range onto a second line, leaving the middot that joins them hanging at the
   * end of the first. "Wed" fits, says the same thing, and is the fix that
   * costs the row nothing.
   */
  return start.toLocaleDateString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function timeLabel(locale: string, ms: number): string {
  return new Date(ms).toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * One gathering on this list, named so a pick survives leaving the screen.
 *
 * The chain alone is not enough — two sittings of one Wednesday share it, which
 * is the misbinding this whole list was narrowed to today to prevent — so the
 * start is what tells them apart. Same pair the rows are keyed by.
 */
function entryKey(entry: KioskEventEntry): string {
  return `${entry.chain}:${entry.startAt}`;
}

export function EventChooser({
  services,
  printerState,
  printerConfigured,
  printerGuessed = false,
  printerModel,
  printingReady,
  listCameBackEmpty = false,
  onSetUpPrinter,
  onConnectPrinter,
  onLookAgain,
  onPrintTestLabel,
  onPrintingRows,
  selectedKey = null,
  onSelect,
  onBound,
}: {
  services: KioskServices;
  /** Null when this kiosk has no printer and nothing has asked for one yet. */
  printerState: PrinterState | null;
  /**
   * Whether this kiosk has a printer stored, which is a different question from
   * whether one is answering right now.
   *
   * From `printerConfig !== null`, never from `printerState !== null`: the
   * module initialises `idle` and emits it before `ready()` has looked at the
   * bus, so on a kiosk that kept last week's printer `idle` is the first second
   * of every boot rather than evidence of anything. Without this the strip said
   * *No printer on this kiosk* at exactly the moment a volunteer was reading it.
   */
  printerConfigured: boolean;
  /** Whether the stored model or roll had to be guessed — see `PrinterConfig`. */
  printerGuessed?: boolean;
  /** The stored model, named in the ready line so the fact is checkable. */
  printerModel?: string;
  /**
   * Whether the printing chunk has landed.
   *
   * The connect is drawn before any row is tapped, so the chunk has to be in
   * memory before the press — `requestDevice` needs transient activation and an
   * `await import` spends it. Until then the slot holds its place at forward
   * weight and says it is waiting.
   */
  printingReady: boolean;
  /** Whether the last connect came back from the browser with nothing picked. */
  listCameBackEmpty?: boolean;
  onSetUpPrinter: () => void;
  /**
   * The three things the strip's filled control can do, all of them in place.
   *
   * None of them navigates. A control whose word is *Connect the printer again*
   * and whose effect is *open a screen with another button on it* is not true at
   * the moment it is read, and unpaired — the Android Sunday — is the one state
   * only a human press on the browser's chooser can fix.
   */
  onConnectPrinter: () => void;
  onLookAgain: () => void;
  onPrintTestLabel: () => void;
  /**
   * Called once the list has arrived, with whether any gathering still bindable
   * today prints. What loads the printing chunk on a kiosk that has no printer
   * of its own yet — the Sunday this whole screen is about.
   */
  onPrintingRows: (any: boolean) => void;
  /**
   * The picked row, held by `KioskApp` rather than here.
   *
   * By `chain:startAt` rather than by index, because the door to the printer
   * screen unmounts this component and the list is refetched on the way back:
   * an index would point at whatever row had moved into that slot. Identity
   * survives the round trip, which is the whole point — *Back to the
   * gatherings* lands on the row still ringed.
   */
  selectedKey?: string | null;
  onSelect: (key: string | null) => void;
  onBound: (binding: KioskBinding) => void;
}) {
  /*
   * See the note on the printer screen's unbind. A screen entered from a
   * `useTap` row mounts before that tap's own click is dispatched, so a bare
   * `onClick` on the screen that arrives answers a press nobody made on it —
   * and this screen is reached that way, from the staff screen's `Change
   * event`.
   */
  const t = useTranslations("Chooser");
  // The printer's own words, borrowed rather than restated: *Look again* and
  // *Looking for the printer…* mean the same thing on both screens, and two
  // catalogue entries for one sentence is how they stop meaning it.
  const tPrinter = useTranslations("Printer");
  const printerNote = usePrinterNote();
  // The kiosk's language, not the tablet's: the dates on these rows are
  // formatted against it. See `eventWindow` in ../binding.ts.
  const locale = useLocale();
  const tap = useTap();
  const [received, setReceived] = useState<KioskEventEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [binding, setBinding] = useState(false);
  const nowMs = useMemo(() => Date.now(), []);

  /*
   * Midnight tonight, by the tablet's own clock.
   *
   * `setHours(24, …)` rather than arithmetic on the epoch: a day is not always
   * 86,400,000 milliseconds long, and the two nights a year it is not are
   * nights a church still meets on.
   */
  const dayEndMs = useMemo(() => {
    const end = new Date(nowMs);
    end.setHours(24, 0, 0, 0);
    return end.getTime();
  }, [nowMs]);

  /*
   * What a volunteer may point this tablet at — see the note at the top.
   *
   * An open window beats the calendar boundary, exactly as it does on the app's
   * chooser: a lock-in that began at eleven is on *yesterday* by the date and
   * is the gathering somebody is standing at right now. That branch is also
   * what keeps the "Ended — pickup only" row reachable, since the server only
   * still sends it while its window is open.
   */
  const entries = useMemo(
    () =>
      received?.filter(
        (entry) =>
          entry.startAt < dayEndMs ||
          (nowMs >= entry.checkInOpensAt && nowMs <= entry.checkInClosesAt),
      ) ?? null,
    [received, dayEndMs, nowMs],
  );

  /**
   * The picked row, resolved from the key `KioskApp` is holding.
   *
   * An index would not survive the printer door: this component unmounts, the
   * list is refetched on the way back, and slot 2 is whatever sorted into slot
   * 2 that time. The key is the gathering.
   */
  const selected = useMemo(() => {
    if (selectedKey === null || !entries) return null;
    const index = entries.findIndex((entry) => entryKey(entry) === selectedKey);
    return index === -1 ? null : index;
  }, [entries, selectedKey]);

  /** The row the commit button is about, or null while nothing is picked. */
  const selectedEntry =
    selected === null ? null : (entries?.[selected] ?? null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      services
        .listEvents()
        .then((events) => {
          if (!cancelled) setReceived(events);
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    void load();
    return () => {
      cancelled = true;
    };
  }, [services]);

  /**
   * Gatherings on this list that print and can still be bound.
   *
   * Ended rows are out: a sentence about tonight must not name a gathering that
   * finished at six. The *mark* on the row stays on them, because that is a fact
   * about the gathering rather than about tonight.
   */
  const bindablePrinting = useMemo(
    () =>
      entries?.filter(
        (entry) => entry.labelTemplate !== null && nowMs <= entry.endAt,
      ) ?? [],
    [entries, nowMs],
  );

  /*
   * What fetches the printing chunk on a kiosk that has never had a printer.
   *
   * The connect is drawn before any row is touched — the hold path never picks
   * one — so the module has to be resident before the first press or the only
   * control on the screen opens a waiting box. `requestDevice` needs transient
   * activation and an `await import` spends it, which is why this cannot wait
   * for the tap that needs it.
   */
  useEffect(() => {
    if (entries === null) return;
    onPrintingRows(bindablePrinting.length > 0);
  }, [entries, bindablePrinting, onPrintingRows]);

  /**
   * Sets the kiosk to one row, from either way in — a held row, or the button.
   *
   * `setSelected` even though the screen is about to be replaced: a bind takes
   * a round trip, and for that second the ringed row has to be the one the
   * thumb is on — otherwise holding a row while another is selected reads as
   * setting up the wrong gathering.
   */
  const bind = async (index: number) => {
    const entry = entries?.[index];
    if (!entry || binding) return;
    onSelect(entryKey(entry));
    setBinding(true);
    try {
      const bound = await services.bindEntry(entry);
      onBound(bound);
    } catch {
      setBinding(false);
      setFailed(true);
    }
  };

  /* ---- The printer, in the foot ----------------------------------------
   *
   * The whole of it is decided here rather than inside the JSX, because the
   * three parts have to agree: the state line names a press only when that
   * press is in the slot, and the slot is what the line is about.
   */

  const kind = printerState?.kind;
  /**
   * The printer is a known negative and a person can act on it now.
   *
   * `unpaired && searching` is deliberately not a fault: those are the first
   * ten seconds after a wake, while the boot retries are still looking, and a
   * kiosk that has not finished looking must not accuse itself.
   */
  const fault =
    printerState !== null &&
    (kind === "trouble" ||
      kind === "unsupported" ||
      (kind === "unpaired" && !printerState.searching));
  /**
   * The kiosk has a printer and does not yet know whether it can see it.
   *
   * One predicate, shared by the sentence, the slot and the commit's sub-line —
   * they used to disagree, so the panel said it was still looking over a button
   * asserting the printer needed connecting.
   */
  const stillLooking =
    printerConfigured &&
    (printerState === null ||
      kind === "idle" ||
      (kind === "unpaired" && printerState.searching));
  const ready = kind === "ready";
  const selectedPrints =
    selectedEntry !== null &&
    selectedEntry.labelTemplate !== null &&
    nowMs <= selectedEntry.endAt;
  /** A row is picked and it does not print: this volunteer has no printer errand. */
  const selectedQuiet = selectedEntry !== null && !selectedPrints;
  const waiting = stillLooking || !printingReady;

  /**
   * Whether the panel is drawn at all.
   *
   * The *door* is drawn whatever happens, at the same pixel — a volunteer
   * connecting the printer on Saturday for a printing Sunday is on a day whose
   * own list has no printing row, and that errand has to stay possible.
   */
  const showPanel = printerConfigured || bindablePrinting.length > 0;

  /**
   * The filled control, or nothing.
   *
   * `unsupported` is the one fault with no press behind it — a browser that
   * cannot talk to USB will not start being able to because somebody asked
   * again — so it keeps the amber line and draws no button. Everything else
   * that can be pressed here does what its word says, on this screen.
   */
  const slot = ((): { label: string; press: () => void } | "waiting" | null => {
    // No panel, no controls: on a day when nothing prints and this kiosk has
    // never had a printer, the foot is the door alone.
    if (!showPanel) return null;
    if (selectedQuiet && !fault) return null;
    if (printerState !== null) {
      // A cable somebody can push back in: re-ask the bus, no dialog. Unpaired
      // is the other errand — the browser has lost the grant and only its own
      // device list gives it back — which is why the two forks differ.
      if (printerState.kind === "trouble")
        return { label: tPrinter("lookAgain"), press: onLookAgain };
      if (printerState.kind === "unpaired" && !printerState.searching)
        return { label: t("connectThePrinterAgain"), press: onConnectPrinter };
      if (printerState.kind === "unsupported") return null;
    }
    if (waiting) return "waiting";
    if (!printerConfigured)
      return { label: t("connectThePrinter"), press: onConnectPrinter };
    if (ready && selectedPrints)
      return { label: tPrinter("testPrint"), press: onPrintTestLabel };
    return null;
  })();
  const slotLabel = slot !== null && slot !== "waiting" ? slot.label : null;

  /**
   * The line under the sentence — what this kiosk's printer is doing.
   *
   * First match wins, and the order is the order a volunteer needs: what the
   * last press did, then what the kiosk has, then what it is doing about it.
   */
  const stateLine = ((): { text: string; tone: string } => {
    if (listCameBackEmpty && slotLabel !== null) {
      // Every press changes the screen. A dismissed device list is the one
      // press that used to leave the strip byte-identical — and the browser
      // reports a dismissal and an empty list with the same code, so this says
      // only what is known and names the press that recovers it first.
      return {
        text: t("nothingWasPicked", { connect: slotLabel }),
        tone: "text-ink-200",
      };
    }
    if (!printerConfigured) {
      // The errand outranks the sentence above it when there is one to do: the
      // line that names a job is the news, and the gathering's name is context.
      return slot === null
        ? { text: t("noPrinterOnThisKiosk"), tone: "text-ink-400" }
        : { text: t("noPrinterPlugOneIn"), tone: "text-ink-200" };
    }
    if (stillLooking)
      return { text: tPrinter("looking"), tone: "text-ink-400" };
    if (printerState !== null && printerState.kind === "unpaired")
      return { text: tPrinter("notConnected"), tone: "text-warn-400" };
    if (
      printerState !== null &&
      (printerState.kind === "trouble" || printerState.kind === "unsupported")
    ) {
      // The kiosk's own message and its advice, joined: the printer screen
      // prints them on two lines and the strip has one to spend.
      const advice =
        printerState.kind === "trouble" ? printerNote(printerState.advice) : "";
      return {
        text: [printerNote(printerState.message), advice]
          .filter(Boolean)
          .join(" "),
        tone: "text-warn-400",
      };
    }
    if (ready && printerGuessed) {
      return {
        text: selectedPrints
          ? t("printerGuessedRoll")
          : t("printerGuessedRollBare"),
        tone: "text-warn-400",
      };
    }
    if (printerState !== null && printerState.kind === "ready") {
      return {
        text: t("printerConnectedModel", {
          model: printerModel ?? printerState.config.model,
        }),
        // Green is for news. On a Wednesday whose gathering prints nothing, a
        // working printer is context — the quiet day keeps the green, because
        // there it is the Saturday errand's receipt for tomorrow's volunteer.
        tone: selectedQuiet ? "text-ink-400" : "text-present-400",
      };
    }
    return { text: t("noPrinterOnThisKiosk"), tone: "text-ink-400" };
  })();

  /**
   * The sentence above it — which gathering this is about.
   *
   * Scope follows the frame. With a row picked it is about that row, because
   * the strip and the commit are one block at the foot and a panel naming Kids
   * Club twelve pixels above a button that binds Wednesday Night reads as one
   * statement about the thing being pressed.
   */
  const namesLine = ((): string | null => {
    if (selectedEntry !== null) {
      return selectedPrints
        ? t("printsNameTagsFor", { names: selectedEntry.title, count: 1 })
        : t("doesNotPrintNameTagsFor", { name: selectedEntry.title });
    }
    if (bindablePrinting.length === 0) return null;
    // De-duped: two sittings of one Wednesday are one gathering as far as this
    // sentence is concerned, and saying the title twice reads as a list of two.
    const titles = [...new Set(bindablePrinting.map((entry) => entry.title))];
    return t("printsNameTagsFor", {
      names: new Intl.ListFormat(locale, { type: "conjunction" }).format(
        titles,
      ),
      count: titles.length,
    });
  })();

  /**
   * Whether the commit is about to cost something.
   *
   * A *known* negative, which is why `stillLooking` is subtracted: a kiosk that
   * has not finished looking for its printer must not accuse itself on the
   * brightest control on the screen.
   */
  const wontPrint = selectedPrints && !ready && !stillLooking;

  return (
    <div className="flex h-full flex-col p-6">
      <div className="pb-4 text-center">
        <div className="text-lg font-medium text-ink-400">{t("question")}</div>
        {/* The only place the rows' hold is written down. Kept to one line and
            below the question, because the person reading it is a volunteer
            setting a tablet up once, not somebody using this screen daily. */}
        <div className="pt-1 text-sm text-ink-500">{t("holdOne")}</div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {entries === null && !failed && (
          <div className="pt-12 text-center text-ink-400">{t("loading")}</div>
        )}
        {failed && (
          <div className="pt-12 text-center text-ink-300">
            {t("loadFailed")}
          </div>
        )}
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          {entries?.map((entry, index) => {
            /*
             * The divider, once, above the first gathering the person who
             * paired this kiosk does not work — and only on a list that has
             * both kinds, since a list with nothing above the line would be a
             * heading over everything. The rows below it stay bindable: a
             * kiosk stands in whichever room a leader points it at, and the
             * demotion is the app's own grammar for "not yours" (see
             * `LockedGatherings`), not a refusal. Sorted by the server, so
             * the first `yours: false` row is where the line goes.
             */
            const notYours = entry.yours === false;
            const divider =
              notYours && index > 0 && entries[index - 1]!.yours !== false;
            /*
             * Taking arrivals now — and the ring that says so is spent on the
             * row somebody should actually bind. A gathering that has finished
             * keeps an open window on purpose (a kiosk rebooting mid-pickup has
             * to find it again), so it satisfied this too, and the loudest
             * signal on the list was pointing at the one row that must not be
             * bound for an ordinary evening. It says "Ended — pickup only" in
             * amber instead; see below.
             */
            const live =
              nowMs >= entry.checkInOpensAt && nowMs <= entry.checkInClosesAt;
            // Finished, but still offered because its window has not closed —
            // the row a kiosk rebooting mid-pickup needs to find. Said out
            // loud so it cannot be mistaken for something upcoming.
            const ended = nowMs > entry.endAt;
            /*
             * The third state, and the one this list spent longest without.
             *
             * The chooser offers the week on purpose, so most rows on it are
             * ahead — and a volunteer binding one is doing the ordinary thing,
             * setting a tablet up before doors. What was missing was the
             * consequence: the kiosk will not take arrivals there until the
             * window opens, and a row that said nothing left that to be
             * discovered by a family at the front of a queue. The day is
             * already up in `dayLabel`; this is the sentence that turns it
             * from a fact into a warning.
             */
            const notOpenYet = nowMs < entry.checkInOpensAt;
            const isSelected = selected === index;
            return (
              <Fragment key={`${entry.chain}:${entry.startAt}`}>
                {/* A row in the list's own rhythm, so the `gap` is the space on
                    both sides of the line; the label wears the app's not-yours
                    heading exactly. */}
                {divider && (
                  <div className="border-t border-ink-800 pt-4 text-xs font-bold tracking-wider text-ink-400 uppercase">
                    {t("notYours")}
                  </div>
                )}
                <HoldButton
                  onTap={() => onSelect(entryKey(entry))}
                  onHeld={() => void bind(index)}
                  /*
                   * `active:` on a row, and the transition narrowed to the border
                   * to let it land.
                   *
                   * A row is held as well as tapped, and a hold now waits
                   * `HOLD_DELAY_MS` before its bar appears — so without a pressed
                   * state the first fifth of a second of every press on this
                   * screen was a row doing nothing at all. `transition-colors`
                   * covered the background too, which would have faded that
                   * answer in over its own 150ms and spent the delay twice; the
                   * ring it was written for is the border, and that still moves.
                   */
                  className={`rounded-xl border-2 p-5 text-left transition-[border-color] active:bg-ink-700 ${
                    binding ? "pointer-events-none " : ""
                  }${
                    isSelected
                      ? "border-brand-500 bg-ink-800"
                      : live && !ended
                        ? "border-present-500/60 bg-ink-900"
                        : "border-ink-800 bg-ink-900"
                  }`}
                >
                  {/*
                   * The gathering's mark, in the title rather than in a column
                   * of its own.
                   *
                   * A column was the first answer and it was billed to the wrong
                   * line: sixty pixels off a 390px phone, taken out of the *meta*
                   * line — which is the one line on this screen that tells two
                   * occurrences of the same weekly gathering apart, and the whole
                   * reason this list was narrowed to today. An icon cannot do
                   * that job at all (both Wednesdays wear the same glyph, because
                   * it belongs to the gathering and not to the night), so it must
                   * not be the thing that crowds the line that can.
                   *
                   * Set in the title it costs one character of the title's own
                   * measure, keeps the rows' left edge without a spacer, and is
                   * simply absent on a gathering nobody gave an icon.
                   */}
                  <div
                    className={`text-xl font-semibold ${notYours ? "text-ink-300" : "text-ink-100"}`}
                  >
                    {/* No slot held open for a gathering with no mark. It was,
                      for a round, so that titles in a half-marked list kept one
                      left edge — and an empty slot beside a filled one reads as
                      a mark that failed to draw rather than as a gathering that
                      never had one. The card's own edge is the column here; the
                      title simply starts with its first letter, which is what
                      the mark does on every other screen it appears on. */}
                    <EventName path={entry.iconPath} title={entry.title} />
                  </div>
                  <div className="pt-1 text-ink-400">
                    {/*
                     * Bound so a wrap breaks *between* facts, never after the
                     * middot that joins them. On the phone this line always
                     * wraps, and it used to leave a separator hanging at the
                     * right edge of line one and open line two with the tail of
                     * the room — after which the status, set off by nothing but
                     * a word-space, read as a phrase about the room.
                     */}
                    {/*
                     * The day is free to break, the hours are not.
                     *
                     * Both bound together took a dated row — "Wednesday, Aug 12
                     * · 10:31 PM–12:01 AM", which is what a gathering still open
                     * from yesterday looks like — clean out of the card on a
                     * phone. A time range broken across two lines is unreadable,
                     * a date is not, so the range is the half that is held.
                     */}
                    {/*
                     * The facts, wrapped so the 16px before the status is a gap
                     * between two things on one line and never an indent at the
                     * head of a wrapped one.
                     *
                     * It was `sm:pl-4` on the status itself, which is the same
                     * objection the middot above answers: a separator is a join,
                     * and a join has nothing to do at the edge of a line. With a
                     * room named the length a church names one — "Fellowship
                     * Hall" — the status drops to a second line, and it arrived
                     * there hanging 17px off a left edge that belongs to
                     * nothing. `padding-inline-end` on an inline box lands at
                     * the end of its last line, which is exactly where the gap
                     * has a job.
                     */}
                    <span className="sm:pe-4">
                      {dayLabel(locale, entry.startAt, nowMs)}
                      {" · "}
                      {/*
                       * The hours, a step louder than the line they are in.
                       *
                       * The one fact that tells two sittings of one gathering
                       * apart, and until now the quietest thing on the row: two
                       * identical titles, two identical marks, one green border on
                       * whichever happened to be open, and the discriminator set
                       * in the base weight of the dimmest line. Everything loud on
                       * the row pointed at the same place; the volunteer picked on
                       * colour. This is the only fact on a row that a mark cannot
                       * carry — an icon belongs to the gathering, so both sittings
                       * wear it — which is exactly why it is the one that had to
                       * come up.
                       */}
                      <span className="font-medium whitespace-nowrap text-ink-200">
                        {timeLabel(locale, entry.startAt)}–
                        {timeLabel(locale, entry.endAt)}
                      </span>
                      {/*
                       * Where the gathering is and whether it prints, as one
                       * run.
                       *
                       * The mark is the one fact this chooser never carried, and
                       * the reason the printer could be skipped without anybody
                       * noticing: nothing on the screen said which gatherings
                       * need one. It is keyed off the template alone, so an
                       * *ended* printing row wears it too — the mark is about
                       * the gathering, not about tonight. The sentence in the
                       * foot is the one that has to be careful about tonight.
                       *
                       * Room and mark share a line, and that is the whole of
                       * why they share a span. Copying the room's own
                       * `block sm:inline` gave the mark a line of its own below
                       * `sm`, which grew every printing row by 24px on a phone —
                       * a cost on a shape this campaign never looked at, paid by
                       * a screen that is a list. Both are facts about the
                       * gathering and "Hall · Prints name tags" is 23 characters;
                       * they fit.
                       *
                       * The middot between them is always drawn because they are
                       * always on one line together. The one *before* them is
                       * not: a separator is a join, and a join has nothing to do
                       * at the start of a line — which is where the phone puts
                       * this, every time, because three facts and a status do
                       * not fit in 297 pixels.
                       */}
                      {(entry.location || entry.labelTemplate !== null) && (
                        <>
                          <span className="hidden sm:inline"> · </span>
                          <span className="block sm:inline">
                            {entry.location && (
                              <span className="whitespace-nowrap">
                                {entry.location}
                              </span>
                            )}
                            {entry.location && entry.labelTemplate !== null && (
                              <span className="whitespace-nowrap"> · </span>
                            )}
                            {entry.labelTemplate !== null && (
                              <span className="whitespace-nowrap text-ink-300">
                                {t("printsNameTags")}
                              </span>
                            )}
                          </span>
                        </>
                      )}
                    </span>
                    {/* Where the gathering is becomes what the gathering is
                      doing, and on a phone that step has to be a line rather
                      than a wider space — the fold puts them side by side. */}
                    {/*
                     * Open, *unless* the gathering has already ended — the two
                     * were drawn together, because a finished gathering whose
                     * window is still open is both, and the row said "Check-in
                     * open" in green directly above "Ended — pickup only" in
                     * amber. Two statuses on one row is one too many, and the
                     * later fact is the one a volunteer has to act on.
                     */}
                    {live && !ended && (
                      <span className="block font-medium text-present-400 sm:inline-block">
                        {t("checkInOpen")}
                      </span>
                    )}
                    {notOpenYet && (
                      <span className="block font-medium text-ink-500 sm:inline-block">
                        {t("opensAt", {
                          when: timeLabel(locale, entry.checkInOpensAt),
                        })}
                      </span>
                    )}
                    {/*
                     * The one status on this list that is a warning rather than
                     * a fact. "Check-in opens 6:30" is the ordinary case — a
                     * volunteer setting a tablet up before doors — and quiet ink
                     * is right for it. A gathering that has *ended* is still
                     * offered only so a kiosk rebooting mid-pickup can find it
                     * again, and binding one for an ordinary evening is a
                     * mistake; it read in the same grey as the ordinary case,
                     * which is the row saying nothing at the one place it has
                     * something to say.
                     */}
                    {ended && (
                      <span className="block font-medium text-warn-400 sm:inline-block">
                        {t("endedPickupOnly")}
                      </span>
                    )}
                  </div>
                </HoldButton>
              </Fragment>
            );
          })}
          {entries?.length === 0 && (
            <div className="pt-12 text-center text-ink-400">
              {/* "Today" rather than "this week", because that is now what the
                  list holds — and a volunteer reading this on a Tuesday should
                  go looking for tonight's gathering rather than concluding the
                  calendar is empty until Sunday. */}
              {t("nothingToday")}
            </div>
          )}
        </div>
      </div>

      {/*
       * Everything below the kiosk breakpoint is denser than the design above
       * it, and the reason is arithmetic rather than taste.
       *
       * The panel was drawn for an 800×1280 shelf tablet, where it costs a
       * fifth of the glass and its sentences are one line each. An iPhone is
       * 664 points tall: the same panel at the same scale took this foot from
       * 216px to 328px and left a list — the whole point of the screen — with
       * 244px, which is one row of a list whose rows are 148px. A volunteer
       * looking for tonight's gathering on a phone could see one of them.
       *
       * So every measurement in here has a `kiosk:` twin holding the reviewed
       * value, and the bare one is the phone's: smaller type in the panel, a
       * 44px control rather than 48, and a seam instead of a margin. It buys
       * the list back its second row and changes nothing at 800×1280.
       */}
      <div className="mx-auto w-full max-w-2xl pt-2 pb-[max(1rem,var(--spacing-safe-bottom))] kiosk:pt-4">
        {/*
         * The second way in to installing, for a kiosk that was paired in a
         * browser tab and is being tidied up afterwards. The first is the
         * pairing screen, which is where it does the most good — see
         * components/InstallPrompt.tsx. Renders nothing once installed, which
         * is the state this screen is usually in.
         */}
        <InstallPrompt className="mb-3" />

        {/*
         * The printer, said out loud before anybody touches a row.
         *
         * This was one hairline row reading "Set up a label printer", in the
         * style of the optional install prompt above it, and the screen said
         * nothing at all about which gatherings print. A volunteer who did
         * exactly what it asked — hold a row, set the kiosk — bound a printing
         * gathering with no printer and found out at the first family.
         *
         * So: a panel, drawn from first paint whenever a gathering today needs
         * a printer or this kiosk has one. It names the gathering it is about
         * and says the printer's state in a colour that means it, and its
         * connect is a real button before any gesture — the hold path never
         * picks a row, so a control that waits for a selection is a control
         * that path never sees.
         *
         * The door stays, last and flush right, at one pixel position in every
         * state including the two with no panel. How many controls exist used
         * to decide where each one sat, so tapping a row moved the door 509px
         * and dropped a button that opens the browser's USB dialog onto the
         * pixels it had just vacated.
         */}
        <div
          className={`mb-2 p-2.5 kiosk:mb-6 kiosk:p-5 ${showPanel ? "rounded-xl bg-ink-900" : ""}`}
        >
          {showPanel && namesLine !== null && (
            <div className="text-sm text-ink-300 kiosk:text-base">
              {namesLine}
            </div>
          )}
          {showPanel && (
            <div
              className={`text-sm font-medium kiosk:text-lg ${namesLine !== null ? "pt-1 " : ""}${stateLine.tone}`}
            >
              {stateLine.text}
            </div>
          )}
          <div
            className={`flex items-center justify-end gap-4 ${showPanel ? "mt-2 kiosk:mt-3" : ""}`}
          >
            {slot === "waiting" ? (
              /*
               * The same box, fill and weight as the live control, differing by
               * a moving mark and two words.
               *
               * `aria-disabled` rather than `disabled`, because `disabled`
               * suppresses `:active` — and a 494px filled control that absorbs
               * a press without acknowledging it is the "is this thing frozen"
               * moment on a lobby tablet. One label for both waits (the chunk,
               * and the boot retries); the line above says which.
               */
              <button
                type="button"
                tabIndex={-1}
                aria-disabled
                aria-busy
                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border-2 border-ink-600 bg-ink-700 px-4 font-medium text-ink-50 active:bg-ink-600 kiosk:h-14"
              >
                <span
                  aria-hidden
                  className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
                />
                {t("oneMoment")}
              </button>
            ) : (
              slot !== null && (
                /* The edge is `ink-600` rather than the rows' `ink-800`: in the
                   light ramp `ink-800` sits *between* this fill and the panel,
                   so it softens the boundary instead of drawing it. One rung
                   toward the reader from the fill in both ramps, which is the
                   row family's own construction at the control's rung. */
                <button
                  type="button"
                  tabIndex={-1}
                  {...tap(slot.press)}
                  className="h-11 flex-1 rounded-lg border-2 border-ink-600 bg-ink-700 px-4 font-medium text-ink-50 active:bg-ink-600 kiosk:h-14"
                >
                  {slot.label}
                </button>
              )
            )}
            <button
              type="button"
              tabIndex={-1}
              {...tap(onSetUpPrinter)}
              className="h-11 shrink-0 font-medium text-ink-300 underline underline-offset-4 active:text-ink-100 kiosk:h-14"
            >
              {t("printerSettings")}
            </button>
          </div>
        </div>

        <button
          type="button"
          tabIndex={-1}
          {...tap(() => {
            if (selected !== null) void bind(selected);
          })}
          /* The not-yet branch keeps the box and drops the skin. A filled
             `ink-800` slab with dim type in it reads as an input waiting to be
             filled in rather than as a button waiting for a row; the border
             holds the 672×96 so nothing moves when a tap arms it. */
          className={`w-full rounded-xl border-2 border-transparent p-4 text-lg font-semibold kiosk:p-5 kiosk:text-xl ${
            selected !== null && !binding
              ? "bg-brand-600 text-white active:bg-brand-500"
              : "pointer-events-none text-ink-500"
          }`}
          /* What `HoldButton` used to set here, in the version a tap can have:
             it swallowed the gesture outright, and a plain button only has to
             stop a second press inside the double-tap window from zooming the
             screen a volunteer is trying to set up. */
          style={{ touchAction: "manipulation" }}
        >
          {/*
           * What is about to be bound, on the thing being pressed.
           *
           * The row a volunteer picked is at the top of a tablet and this
           * button is at the bottom — half a phone screen away, three quarters
           * of a portrait kiosk — and where two sittings of one gathering are
           * on the list, the row's border changing colour up there is not an
           * answer to "which one". The hours are what disambiguate, so the
           * hours are what this carries, and the mark comes with them because
           * here it costs one character of a line that had nothing on it.
           *
           * It mattered more when this was a hold, and it still earns the
           * line: what is being confirmed reads before the word for
           * confirming it, in that order, which is the order somebody
           * checking their own work reads them in.
           *
           * The name truncates and the time does not. One `truncate` over the
           * whole run clipped from the right, which is where the clock is —
           * so the first thing a long gathering name cost the button was the
           * only fact on it that tells two sittings apart. A long name losing
           * its tail costs nothing here: both sittings share it.
           */}
          {/*
           * The line's height is held whether or not there is anything on it.
           *
           * Added, it grew the button by 28px — and this block is anchored to
           * the bottom of the screen, so the tap that picked a gathering paid
           * for those pixels upward: the printer door and the foot of the
           * scrolling list both jumped under the thumb that had just landed.
           * The band above is empty in both states, so holding the taller
           * geometry costs nothing to look at and keeps the promise the roster
           * makes about its own rows — a tap moves nothing.
           */}
          {(binding || !selectedEntry) && (
            <span
              aria-hidden
              className="invisible mb-1 block text-sm font-medium kiosk:text-base"
            >
              &nbsp;
            </span>
          )}
          {!binding && selectedEntry && (
            /*
             * Three facts, two ranks, and the separators outside both.
             *
             * The gathering and the hour are what is being committed to, so
             * both are white; the middots join them and belong to neither, so
             * they are the step back — set as their own flex children, because
             * inside the clause spans the second one rendered visibly bolder
             * than the first, punctuation joining the emphasis.
             *
             * The clause is the loudest thing on the button because it is the
             * only one that costs anything, and *Set kiosk* keeps its word, its
             * fill and its place: a volunteer whose gathering prints nothing is
             * never blocked, only told.
             */
            <span className="mb-1 flex items-baseline justify-center gap-1 text-sm font-medium kiosk:text-base">
              <span className="min-w-0 truncate text-white">
                <EventName
                  path={selectedEntry.iconPath}
                  title={selectedEntry.title}
                  tone="inherit"
                />
              </span>
              <span className="shrink-0 text-white/75">·</span>
              <span className="shrink-0 text-white">
                {timeLabel(locale, selectedEntry.startAt)}
              </span>
              {wontPrint && (
                <>
                  <span className="shrink-0 text-white/75">·</span>
                  <span className="shrink-0 font-semibold text-white">
                    {t("nameTagsWontPrint")}
                  </span>
                </>
              )}
            </span>
          )}
          {binding
            ? t("settingUp")
            : selected !== null
              ? t("setKiosk")
              : t("pickAGathering")}
        </button>
      </div>
    </div>
  );
}
