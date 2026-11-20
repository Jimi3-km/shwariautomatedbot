import React, { useEffect, useState } from 'react';
import { getFacebookPages, selectFacebookPage } from '../lib/api';
import type { FacebookPageChoice } from '../types';
import { useMutation } from '../hooks';
import { Button, InlineError, LoadingState, Modal } from './ui';

/**
 * "Which Page is this business's?"
 *
 * Shown when the person who signed in with Facebook manages more than one
 * Page. Nothing is connected until they choose: the server keeps the Pages it
 * was offered for a few minutes and sends only their names here.
 */
export function FacebookPagePicker({ open, onClose, onConnected }: {
  open: boolean;
  onClose: () => void;
  onConnected: (pageName: string | null) => void;
}) {
  const [pages, setPages] = useState<FacebookPageChoice[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chosen, setChosen] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPages(null);
    setLoadError(null);
    setChosen('');
    getFacebookPages()
      .then((r) => { if (!cancelled) setPages(r.pages); })
      .catch(() => { if (!cancelled) setLoadError("We couldn't load your Pages. Please try again."); });
    return () => { cancelled = true; };
  }, [open]);

  const connect = useMutation(async (pageId: string) => {
    const r = await selectFacebookPage(pageId);
    onConnected(r.account.display_name);
  });

  function close() { connect.clearError(); onClose(); }

  const expired = pages !== null && pages.length === 0;

  return (
    <Modal
      open={open} onClose={close} title="Which Page is this business's?" width={460}
      footer={
        <>
          <Button variant="subtle" onClick={close} disabled={connect.busy}>{expired ? 'Close' : 'Cancel'}</Button>
          {!expired && (
            <Button
              variant="solid" loading={connect.busy} disabled={!chosen}
              onClick={() => chosen && connect.run(chosen)}
            >
              Connect this Page
            </Button>
          )}
        </>
      }
    >
      <InlineError message={loadError ?? connect.error} onDismiss={connect.clearError} />

      {pages === null && !loadError && <LoadingState label="Loading your Pages…" />}

      {expired && (
        <p style={{ fontSize: 13.5, color: 'var(--text-2)', lineHeight: 1.6 }}>
          That choice has expired, so nothing was connected. Press Connect on Facebook Page again to pick a Page.
        </p>
      )}

      {pages !== null && pages.length > 0 && (
        <>
          <p style={{ fontSize: 13.5, color: 'var(--text-2)', lineHeight: 1.6 }}>
            You manage more than one Facebook Page. Choose the one customers message this business on.
            Its messages come to your inbox, and approved posts go out on it.
          </p>
          <div role="radiogroup" aria-label="Facebook Pages" style={{ display: 'grid', gap: 8, marginTop: 14 }}>
            {pages.map((p) => (
              <label
                key={p.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer',
                  border: `1px solid ${chosen === p.id ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 'var(--radius)',
                }}
              >
                <input
                  type="radio" name="facebook-page" value={p.id}
                  checked={chosen === p.id} onChange={() => setChosen(p.id)}
                />
                <span style={{ fontSize: 13.5, overflowWrap: 'anywhere' }}>{p.name}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
