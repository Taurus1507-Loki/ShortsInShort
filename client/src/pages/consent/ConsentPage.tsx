import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { CheckCircle2, Loader2, ShieldCheck, ShieldOff, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import type { ConsentDetails } from '@/types/api';

/**
 * Public page for the person whose voice it is (no account needed): confirm a request, or withdraw
 * consent. The token stays in the page and is sent in a POST body, never in an API URL.
 */
export default function ConsentPage({ purpose }: { purpose: 'confirm' | 'withdraw' }) {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [details, setDetails] = useState<ConsentDetails | null>(null);
  const [error, setError] = useState<string | null>(token ? null : 'This link is missing its token.');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true;
    api<{ data: ConsentDetails }>('/consent/lookup', { method: 'POST', body: { token, purpose } })
      .then((r) => setDetails(r.data))
      .catch((e) => setError(errorMessage(e)));
  }, [token, purpose]);

  const act = async () => {
    setBusy(true);
    try {
      const r = await api<{ data: ConsentDetails }>(`/consent/${purpose}`, { method: 'POST', body: { token } });
      setDetails(r.data);
      setDone(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <div className="text-center">
        <XCircle className="mx-auto h-12 w-12 text-destructive" />
        <h1 className="mt-4 text-2xl font-bold">Link not valid</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error}</p>
        <Button asChild variant="outline" className="mt-6 w-full">
          <Link to="/">Go to ShortsInShort</Link>
        </Button>
      </div>
    );
  }
  if (!details) {
    return (
      <div className="text-center" role="status">
        <Loader2 className="mx-auto h-10 w-10 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const revoked = details.status === 'revoked';
  const statement = (
    <blockquote className="my-4 rounded-lg border-l-4 border-primary bg-primary/5 px-4 py-3 text-sm font-medium leading-relaxed">{details.statementText}</blockquote>
  );

  if (purpose === 'withdraw') {
    return (
      <div aria-live="polite">
        {revoked ? (
          <div className="text-center">
            <ShieldOff className="mx-auto h-12 w-12 text-success" />
            <h1 className="mt-4 text-2xl font-bold">Consent withdrawn</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              The AI voice “{details.voiceName}” and your recordings have been deleted. It can no longer be used for new content.
            </p>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-bold">Withdraw voice consent</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Hi {details.subjectName}. {details.relationship === 'other' ? `${details.requesterName} asked` : 'You agreed'} to create the AI voice “{details.voiceName}” for the “
              {details.workspaceName}” workspace, with this statement:
            </p>
            {statement}
            <p className="text-sm text-muted-foreground">Withdrawing deletes the AI voice and your recordings straight away. Content already made with it isn’t removed.</p>
            <Button variant="destructive" className="mt-6 w-full" loading={busy} onClick={act}>
              <ShieldOff /> Withdraw consent and delete the voice
            </Button>
          </>
        )}
      </div>
    );
  }

  const confirmed = details.status === 'active';
  return (
    <div aria-live="polite">
      {done || confirmed ? (
        <div className="text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
          <h1 className="mt-4 text-2xl font-bold">Consent confirmed</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Thanks, {details.subjectName}. The voice is being created for {details.requesterName}. You can withdraw at any time with the link in the email we sent you.
          </p>
        </div>
      ) : revoked ? (
        <Notice tone="info" title="This request was withdrawn">
          Nothing was created, and the recordings were deleted.
        </Notice>
      ) : (
        <>
          <h1 className="text-2xl font-bold">Confirm your voice consent</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Hi {details.subjectName}. <strong className="text-foreground">{details.requesterName}</strong> wants to create an AI copy of your voice called “{details.voiceName}” for the “
            {details.workspaceName}” workspace on ShortsInShort. They uploaded a recording of you saying:
          </p>
          {statement}
          <ul className="grid list-disc gap-1 pl-5 text-sm text-muted-foreground">
            <li>Only confirm if that recording is really you and you agree.</li>
            <li>The voice can be used for voiceovers made in that workspace.</li>
            <li>You can withdraw at any time — the voice and recordings are then deleted.</li>
          </ul>
          <Button variant="gradient" className="mt-6 w-full" loading={busy} onClick={act}>
            <ShieldCheck /> Yes, I agree — create my voice
          </Button>
          <p className="mt-3 text-center text-xs text-muted-foreground">Not you, or you don’t agree? Ignore the email (nothing is created), or use its “withdraw” link.</p>
        </>
      )}
    </div>
  );
}
