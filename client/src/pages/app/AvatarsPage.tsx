import { Link } from 'react-router';
import { Mic, ScanFace, UserRound } from 'lucide-react';
import { PageHeader } from '@/components/app/AppLayout';
import { PhotoAvatars } from '@/components/app/PhotoAvatars';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/primitives';

/** Personal branding: your photo avatar + your cloned voice → videos of you, without filming. */
export default function AvatarsPage() {
  const steps = [
    { icon: ScanFace, title: '1. Your avatar', text: 'Upload one clear photo and record a short consent sentence.' },
    { icon: Mic, title: '2. Your voice', text: 'Clone your voice in AI Voices (a short sample and the same consent).', to: '/app/voices' },
    { icon: UserRound, title: '3. Your video', text: 'Start an AI Avatar video, pick your avatar and voice, paste your script.', to: '/app/new?mode=avatar' },
  ];
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="My Avatar"
        description="Be on screen every day without filming: a talking avatar made from one photo, speaking your scripts in your own voice."
        actions={
          <Button asChild variant="gradient">
            <Link to="/app/new?mode=avatar">
              <UserRound /> New avatar video
            </Link>
          </Button>
        }
      />
      <div className="grid gap-6">
        <div className="grid gap-3 sm:grid-cols-3">
          {steps.map((s) => (
            <Card key={s.title}>
              <CardContent className="grid gap-1.5 pt-5 text-sm">
                <s.icon className="h-5 w-5 text-primary" />
                <p className="font-semibold">{s.title}</p>
                <p className="text-muted-foreground">{s.text}</p>
                {s.to && (
                  <Link to={s.to} className="text-xs font-medium text-primary underline-offset-2 hover:underline">
                    Open →
                  </Link>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
        <PhotoAvatars />
      </div>
    </div>
  );
}
