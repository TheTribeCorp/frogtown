import { useState, type FormEvent } from 'react';
import { Download, FileKey2, KeyRound, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  createEncryptedIdentityBackup,
  restoreEncryptedIdentityBackup,
} from '@/lib/e2ee';

export function EncryptionRecoveryPanel({
  walletAddress,
  restoreOnly = false,
  onRestored,
}: {
  walletAddress: string;
  restoreOnly?: boolean;
  onRestored?: () => void;
}) {
  const [backupPassphrase, setBackupPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [restorePassphrase, setRestorePassphrase] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<'backup' | 'restore' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const downloadBackup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setNotice('');
    if (backupPassphrase !== confirmation) {
      setError('The recovery passphrases do not match.');
      return;
    }
    setBusy('backup');
    try {
      const backup = await createEncryptedIdentityBackup(walletAddress, backupPassphrase);
      const url = URL.createObjectURL(backup);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `frogtown-key-backup-${walletAddress.slice(0, 6)}.json`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setBackupPassphrase('');
      setConfirmation('');
      setNotice('Encrypted backup downloaded. Keep the file and passphrase in separate safe places.');
      window.dispatchEvent(new CustomEvent('frogtown:encrypted-backup-created', {
        detail: { walletAddress },
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the encrypted backup.');
    } finally {
      setBusy(null);
    }
  };

  const restoreBackup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setNotice('');
    if (!file) {
      setError('Choose your Frogtown backup file first.');
      return;
    }
    setBusy('restore');
    try {
      await restoreEncryptedIdentityBackup(walletAddress, file, restorePassphrase);
      setRestorePassphrase('');
      setNotice('Encryption key restored on this device.');
      onRestored?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not restore this encryption backup.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-[1.25rem] border border-[hsl(var(--primary)/.22)] bg-[hsl(var(--card)/.82)] p-5 md:p-6" data-testid="panel-encryption-recovery">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]">
          <FileKey2 className="size-4" />
        </span>
        <div>
          <h2 className="font-semibold">Private chat recovery</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[hsl(var(--muted-foreground))]">
            Your recovery file is encrypted in this browser with a passphrase you choose. Frogtown never receives the file or passphrase. Without both, encrypted chat history cannot be restored.
          </p>
          <p className="mt-2 max-w-2xl text-[10px] leading-4 text-[hsl(var(--muted-foreground))]">
            Keys created before recovery backups were added cannot be exported from the browser. Keep that original device; do not replace its key if you need its older chats.
          </p>
        </div>
      </div>

      {!restoreOnly && (
        <form onSubmit={downloadBackup} className="mt-5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.55)] p-4" data-testid="form-create-key-backup">
          <div className="flex items-center gap-2 text-xs font-medium"><KeyRound className="size-3.5 text-[hsl(var(--primary))]" /> Create an encrypted backup</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-[10px] text-[hsl(var(--muted-foreground))">
              Recovery passphrase (12+ characters)
              <input
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={512}
                required
                value={backupPassphrase}
                onChange={(event) => setBackupPassphrase(event.target.value)}
                className="mt-1.5 w-full rounded-lg border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-3 py-2.5 text-xs text-[hsl(var(--foreground))]"
                data-testid="input-backup-passphrase"
              />
            </label>
            <label className="text-[10px] text-[hsl(var(--muted-foreground))">
              Confirm passphrase
              <input
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={512}
                required
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                className="mt-1.5 w-full rounded-lg border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-3 py-2.5 text-xs text-[hsl(var(--foreground))]"
                data-testid="input-backup-passphrase-confirm"
              />
            </label>
          </div>
          <button type="submit" disabled={busy !== null} className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-lg bg-[hsl(var(--foreground))] px-3.5 text-xs font-medium text-[hsl(var(--card))] hover:bg-[hsl(var(--primary))] disabled:opacity-50" data-testid="button-download-key-backup">
            {busy === 'backup' ? <RefreshCw className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
            Download backup
          </button>
        </form>
      )}

      <form onSubmit={restoreBackup} className="mt-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.55)] p-4" data-testid="form-restore-key-backup">
        <div className="flex items-center gap-2 text-xs font-medium"><ShieldCheck className="size-3.5 text-[hsl(var(--primary))]" /> Restore on this device</div>
        <label className="mt-3 block text-[10px] text-[hsl(var(--muted-foreground))">
          Frogtown backup file
          <input
            type="file"
            accept="application/json,.json"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="mt-1.5 block w-full text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-[hsl(var(--primary)/.1)] file:px-3 file:py-2 file:text-[10px] file:font-medium file:text-[hsl(var(--primary))]"
            data-testid="input-key-backup-file"
          />
        </label>
        <label className="mt-3 block text-[10px] text-[hsl(var(--muted-foreground))">
          Recovery passphrase
          <input
            type="password"
            autoComplete="current-password"
            required
            value={restorePassphrase}
            onChange={(event) => setRestorePassphrase(event.target.value)}
            className="mt-1.5 w-full rounded-lg border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-3 py-2.5 text-xs text-[hsl(var(--foreground))]"
            data-testid="input-restore-passphrase"
          />
        </label>
        <button type="submit" disabled={busy !== null || !file} className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-lg border border-[hsl(var(--border))] px-3.5 text-xs font-medium hover:bg-[hsl(var(--muted))] disabled:opacity-50" data-testid="button-restore-key-backup">
          {busy === 'restore' ? <RefreshCw className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />}
          Restore key
        </button>
      </form>

      {error && <p role="alert" className="mt-3 rounded-lg bg-[hsl(var(--destructive)/.08)] px-3 py-2 text-xs text-[hsl(var(--destructive))]" data-testid="error-key-recovery">{error}</p>}
      {notice && <p role="status" className="mt-3 rounded-lg bg-[hsl(var(--primary)/.08)] px-3 py-2 text-xs text-[hsl(var(--primary))]" data-testid="status-key-recovery">{notice}</p>}
    </section>
  );
}
