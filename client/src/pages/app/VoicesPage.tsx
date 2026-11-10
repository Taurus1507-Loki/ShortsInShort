import { Link } from 'react-router';
import { Mic } from 'lucide-react';
import { PageHeader } from '@/components/app/AppLayout';
import { VoicePicker } from '@/components/app/VoicePicker';
import { CustomVoices } from '@/components/app/CustomVoices';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/primitives';

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
        <CustomVoices />
        <Card>
          <CardContent className="pt-6">
            <VoicePicker />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
