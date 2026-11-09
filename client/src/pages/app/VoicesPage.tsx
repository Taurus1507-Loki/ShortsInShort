import { Link } from 'react-router';
import { Mic, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/app/AppLayout';
import { VoicePicker } from '@/components/app/VoicePicker';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/primitives';

/** Voice Library: browse and sample the AI voices available for voiceovers. */
export default function VoicesPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="AI Voices"
        description="Listen to every voice before you use it. Samples are free; credits are only used when you generate a voiceover."
        actions={
          <Button asChild variant="gradient">
            <Link to="/app/new?mode=avatar">
              <Mic /> New voiceover project
            </Link>
          </Button>
        }
      />
      <div className="grid gap-6">
        <Card>
          <CardContent className="pt-6">
            <VoicePicker />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" /> Your own voice
            </CardTitle>
            <CardDescription className="mt-1.5">
              Cloning your voice (or someone else’s, with their recorded consent) is coming in the next step. It will require a spoken consent statement and can be withdrawn at any time, which deletes the clone.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
