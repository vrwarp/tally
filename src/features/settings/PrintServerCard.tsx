/**
 * The print server: where the lobby kiosks print over Wi-Fi.
 *
 * One card, set once. The administrator types the print server's address and
 * pastes the bearer token it issued; *Test* asks the server what printers it
 * offers before anything is saved; *Save* hands both to `setPrintServer`, which
 * keeps the token where no browser can read it back and tells every kiosk to
 * re-read. Nothing is typed on a tablet.
 *
 * What the card shows afterwards is the half a person may see: the host, and
 * when it was saved. The token is write-only — the field is empty on every
 * edit, and a blank field on save keeps the token already there, so changing
 * the address never demands the key be found again. docs/wifi-printing.md §2.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { Badge, Button, Card, CardHeader, ErrorBanner, SkeletonRows, TextField } from '@/components/ui';
import { useToast } from '@/context/toastContext';
import { useServerText } from '@/hooks/useServerText';
import { useTimeFormats } from '@/hooks/useTimeFormats';
import {
  browserAddressOf,
  normalisePrintServerAddress,
  printServerHostOf,
} from '@/lib/printServerAddress';
import { setPrintServer } from '@/services/functions';
import {
  probePrintServer,
  readPrintServerConfig,
  type PrintServerStoredConfig,
  type ProbedPrinter,
} from '@/services/printServer';

type Probe = { kind: 'idle' } | { kind: 'asking' } | { kind: 'ok'; printers: ProbedPrinter[] } | { kind: 'failed' };

export function PrintServerCard() {
  const t = useTranslations('PrintServer');
  const tCommon = useTranslations('Common');
  const serverText = useServerText();
  const time = useTimeFormats();
  const { show } = useToast();

  const [stored, setStored] = useState<PrintServerStoredConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState('');
  const [token, setToken] = useState('');
  const [probe, setProbe] = useState<Probe>({ kind: 'idle' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const read = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setStored(await readPrintServerConfig());
    } catch (cause) {
      setLoadError(serverText(cause, t('loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [serverText, t]);

  useEffect(() => {
    void read();
  }, [read]);

  const beginEditing = () => {
    setAddress(stored?.exists ? browserAddressOf(stored.url) : '');
    setToken('');
    setProbe({ kind: 'idle' });
    setSaveError(null);
    setEditing(true);
  };

  const stopEditing = () => {
    setEditing(false);
    setToken('');
    setProbe({ kind: 'idle' });
  };

  // The same normalisation the server applies on save, so a test that passed
  // is a save that works. Null is "not an address", shown under the field.
  const socketUrl = normalisePrintServerAddress(address);
  const addressError = address.trim() !== '' && socketUrl === null ? serverText({ code: 'printServer.badAddress' }) : null;
  const canTest = socketUrl !== null && token.trim() !== '';
  const canSave = socketUrl !== null && (token.trim() !== '' || stored?.exists === true);

  const test = async () => {
    if (!canTest || probe.kind === 'asking') return;
    setProbe({ kind: 'asking' });
    try {
      setProbe({ kind: 'ok', printers: await probePrintServer(socketUrl, token.trim()) });
    } catch {
      setProbe({ kind: 'failed' });
    }
  };

  const save = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const key = token.trim();
      await setPrintServer(key ? { url: address, token: key } : { url: address });
      show(t('saved'), { tone: 'success' });
      stopEditing();
      await read();
    } catch (cause) {
      setSaveError(serverText(cause, t('saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await setPrintServer(null);
      show(t('removed'), { tone: 'success' });
      setConfirmingRemove(false);
      stopEditing();
      await read();
    } catch (cause) {
      setSaveError(serverText(cause, t('saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title={t('title')}
        description={t('description')}
        action={
          !editing && !loading && !loadError ? (
            <Button size="sm" onClick={beginEditing}>
              {stored?.exists ? tCommon('change') : t('setUp')}
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-3 px-4 py-3">
        {loadError ? <ErrorBanner message={loadError} /> : null}
        {saveError ? <ErrorBanner message={saveError} /> : null}

        {loading && !stored ? (
          <>
            <span role="status" className="sr-only">
              {t('checking')}
            </span>
            <div aria-hidden="true">
              <SkeletonRows count={2} />
            </div>
          </>
        ) : editing ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <TextField
              label={t('address')}
              hint={t('addressHint')}
              error={addressError}
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://print.example.org"
              value={address}
              onChange={(event) => {
                setAddress(event.target.value);
                setProbe({ kind: 'idle' });
              }}
            />
            <TextField
              label={t('token')}
              hint={stored?.exists ? `${t('tokenHint')} ${t('tokenKept')}` : t('tokenHint')}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(event) => {
                setToken(event.target.value);
                setProbe({ kind: 'idle' });
              }}
            />

            {probe.kind === 'asking' ? (
              <p role="status" className="text-sm text-ink-300">
                {t('testing')}
              </p>
            ) : probe.kind === 'failed' ? (
              <p role="status" className="rounded-xl bg-warn-500/10 px-3 py-2 text-sm text-warn-400 ring-1 ring-warn-500/25">
                {t('testFailed')}
              </p>
            ) : probe.kind === 'ok' ? (
              <div role="status" className="rounded-xl bg-present-500/10 px-3 py-2 text-sm text-present-400 ring-1 ring-present-500/25">
                <p>{t('testOk', { count: probe.printers.length })}</p>
                {probe.printers.length > 0 ? (
                  <ul className="mt-1 list-disc pl-5">
                    {probe.printers.map((printer) => (
                      <li key={printer.id}>
                        {printer.name}
                        {printer.statusMode === 'none' ? (
                          <span className="text-warn-400"> ({t('printerNoStatus')})</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm" disabled={!canSave} loading={saving}>
                {t('save')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!canTest}
                loading={probe.kind === 'asking'}
                onClick={() => void test()}
              >
                {t('test')}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={stopEditing} disabled={saving}>
                {tCommon('cancel')}
              </Button>
            </div>
          </form>
        ) : stored ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {stored.exists ? (
                <Badge tone="success">{t('inUse', { host: printServerHostOf(stored.url) })}</Badge>
              ) : (
                <Badge tone="neutral">{t('none')}</Badge>
              )}
              {stored.exists && stored.updatedAt ? (
                <span className="text-sm text-ink-300">{t('savedWhen', { when: time.relative(stored.updatedAt) })}</span>
              ) : null}
            </div>
            <p className="text-xs text-ink-500">{t('howItWorks')}</p>

            {stored.exists ? (
              confirmingRemove ? (
                <div className="flex flex-wrap items-center gap-2 rounded-xl bg-warn-500/10 px-3 py-2 text-sm text-warn-400 ring-1 ring-warn-500/25">
                  <span className="flex-1">{t('removeConfirm')}</span>
                  <Button size="sm" variant="danger" onClick={() => void remove()} loading={saving}>
                    {t('removeYes')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmingRemove(false)} disabled={saving}>
                    {tCommon('cancel')}
                  </Button>
                </div>
              ) : (
                <div>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmingRemove(true)}>
                    {t('remove')}
                  </Button>
                </div>
              )
            ) : null}
          </>
        ) : null}
      </div>
    </Card>
  );
}
