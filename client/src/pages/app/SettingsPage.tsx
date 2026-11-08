import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Laptop, LogOut, ShieldCheck, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/app/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Skeleton } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/overlays';
import { useAuth } from '@/features/auth/AuthProvider';
import { api, errorMessage } from '@/lib/api';
import { keys, queryClient, useSessions } from '@/lib/queries';
import { describeUserAgent, timeAgo } from '@/lib/utils';
import type { PublicUser } from '@/types/api';

const password = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(128)
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Include letters and numbers.');

function ProfileCard() {
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user?.fullName ?? '');
  useEffect(() => setName(user?.fullName ?? ''), [user?.fullName]);
  const m = useMutation({
    mutationFn: () => api<{ data: { user: PublicUser } }>('/users/me', { method: 'PATCH', body: { fullName: name.trim() } }),
    onSuccess: (r) => {
      setUser(r.data.user);
      queryClient.invalidateQueries({ queryKey: keys.me });
      toast.success('Profile updated');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!user) return null;
  const invalid = name.trim().length < 2;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>How you appear in ShortsInShort.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-5 sm:max-w-md"
          onSubmit={(e) => {
            e.preventDefault();
            if (!invalid) m.mutate();
          }}
        >
          <Field id="fullName" label="Full name" error={invalid ? 'Name must be at least 2 characters.' : undefined}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" />
          </Field>
          <Field id="email" label="Email" hint={user.emailVerified ? 'Verified' : 'Not verified yet'}>
            <Input value={user.email} disabled />
          </Field>
          <div>
            <Button type="submit" loading={m.isPending} disabled={invalid || name.trim() === user.fullName}>
              Save profile
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

const pwSchema = z
  .object({ currentPassword: z.string().optional(), newPassword: password, confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Passwords don’t match.' });

function PasswordCard() {
  const { user, setUser } = useAuth();
  const { register, handleSubmit, formState, reset } = useForm<z.infer<typeof pwSchema>>({ resolver: zodResolver(pwSchema) });
  if (!user) return null;
  const onSubmit = handleSubmit(async (v) => {
    try {
      const r = await api<{ data: { user: PublicUser } }>('/users/me/password', {
        method: 'POST',
        body: user.hasPassword ? { currentPassword: v.currentPassword, newPassword: v.newPassword } : { newPassword: v.newPassword },
      });
      setUser(r.data.user);
      reset();
      queryClient.invalidateQueries({ queryKey: keys.sessions });
      toast.success('Password updated. Other devices were signed out.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{user.hasPassword ? 'Change password' : 'Set a password'}</CardTitle>
        <CardDescription>{user.hasPassword ? 'Changing your password signs out your other devices.' : 'You sign in with Google. Add a password to also sign in with email.'}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-5 sm:max-w-md" noValidate>
          {user.hasPassword && (
            <Field id="currentPassword" label="Current password">
              <Input type="password" autoComplete="current-password" {...register('currentPassword')} />
            </Field>
          )}
          <Field id="newPassword" label="New password" error={formState.errors.newPassword?.message} hint="At least 10 characters with letters and numbers.">
            <Input type="password" autoComplete="new-password" {...register('newPassword')} />
          </Field>
          <Field id="confirm" label="Confirm new password" error={formState.errors.confirm?.message}>
            <Input type="password" autoComplete="new-password" {...register('confirm')} />
          </Field>
          <div>
            <Button type="submit" loading={formState.isSubmitting}>
              Update password
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function SessionsCard() {
  const { data, isLoading } = useSessions();
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/users/me/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.sessions });
      toast.success('Device signed out');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const revokeOthers = useMutation({
    mutationFn: () => api('/users/me/sessions/revoke-others', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.sessions });
      toast.success('Signed out of all other devices');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const others = data?.filter((s) => !s.current).length ?? 0;
  return (
    <Card>
      <CardHeader className="sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Devices & sessions</CardTitle>
          <CardDescription className="mt-1.5">Devices currently signed in to your account.</CardDescription>
        </div>
        <Button variant="outline" size="sm" disabled={others === 0} loading={revokeOthers.isPending} onClick={() => revokeOthers.mutate()}>
          <LogOut /> Sign out other devices
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-16" />
        ) : (
          <ul className="divide-y divide-border">
            {data?.map((s) => (
              <li key={s.id} className="flex items-center gap-4 py-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                  <Laptop className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    {describeUserAgent(s.userAgent)} {s.current && <Badge variant="success">This device</Badge>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {s.method === 'google' ? 'Google' : 'Password'} · signed in {timeAgo(s.createdAt)} · active {timeAgo(s.lastUsedAt)}
                    {s.ip ? ` · ${s.ip}` : ''}
                  </p>
                </div>
                {!s.current && (
                  <Button variant="ghost" size="sm" onClick={() => revoke.mutate(s.id)} disabled={revoke.isPending}>
                    Sign out
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function DeleteAccountCard() {
  const { user, clear } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const m = useMutation({
    mutationFn: () => api('/users/me', { method: 'DELETE', body: { confirm: 'DELETE', ...(user?.hasPassword ? { password: pw } : {}) } }),
    onSuccess: () => {
      clear();
      toast.success('Your account has been deleted.');
      navigate('/', { replace: true });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!user) return null;
  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive">Delete account</CardTitle>
        <CardDescription>Permanently deactivates your account, signs out every device and removes your projects. This can’t be undone.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          <Trash2 /> Delete my account
        </Button>
      </CardContent>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle className="text-lg font-semibold">Delete your account?</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Your projects and remaining credits will be lost. Type <strong className="text-foreground">DELETE</strong> to confirm.
          </DialogDescription>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              m.mutate();
            }}
          >
            {user.hasPassword && (
              <Field id="del-pw" label="Your password">
                <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
              </Field>
            )}
            <Field id="del-confirm" label="Confirmation">
              <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="DELETE" autoComplete="off" />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" loading={m.isPending} disabled={confirm !== 'DELETE' || (user.hasPassword && !pw)}>
                Delete account
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Account settings" description="Manage your profile, security and devices." />
      <div className="grid gap-6">
        <ProfileCard />
        <PasswordCard />
        <SessionsCard />
        {user?.googleLinked && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-success" /> Google sign-in is linked to this account.
          </p>
        )}
        <DeleteAccountCard />
      </div>
    </div>
  );
}
