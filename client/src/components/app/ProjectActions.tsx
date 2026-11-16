import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Square, Trash2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/overlays';
import { api, errorMessage } from '@/lib/api';
import { keys, queryClient } from '@/lib/queries';
import type { Project } from '@/types/api';

const WHAT: Record<string, string> = { render_project: 'Export', narrate_project: 'Voiceover', plan_scenes: 'Scene planning' };

const refreshAll = (id: string) => {
  queryClient.invalidateQueries({ queryKey: ['projects'] });
  queryClient.invalidateQueries({ queryKey: keys.project(id) });
  queryClient.invalidateQueries({ queryKey: keys.job(id) });
  queryClient.invalidateQueries({ queryKey: keys.estimate(id) });
  queryClient.invalidateQueries({ queryKey: keys.dashboard });
  queryClient.invalidateQueries({ queryKey: keys.me });
};

/** Stops whatever is running for a project (export, voiceover, scene planning), with a refund. */
export function useStopProject(project: Pick<Project, 'id'>) {
  return useMutation({
    mutationFn: () => api<{ data: { project: Project; refundedCredits: number; stopped: string } }>(`/projects/${project.id}/stop`, { method: 'POST' }).then((r) => r.data),
    onSuccess: (d) => {
      queryClient.setQueryData(keys.project(project.id), d.project);
      refreshAll(project.id);
      toast.success(`${WHAT[d.stopped] ?? 'Processing'} stopped${d.refundedCredits ? ` · ${d.refundedCredits} credits refunded` : ''}. Edit anything and try again.`);
    },
    onError: (e) => {
      refreshAll(project.id);
      toast.error(errorMessage(e));
    },
  });
}

export function StopButton({ project, label = 'Stop', size = 'sm' }: { project: Pick<Project, 'id'>; label?: string; size?: 'sm' | 'default' }) {
  const stop = useStopProject(project);
  return (
    <Button variant="outline" size={size} onClick={() => stop.mutate()} loading={stop.isPending} title="Stop and refund the credits for this step">
      <Square /> {label}
    </Button>
  );
}

/** Delete with a confirmation; a running export is stopped and refunded first. */
export function DeleteProjectButton({ project, onDeleted, size = 'sm', iconOnly }: { project: Project; onDeleted?: () => void; size?: 'sm' | 'default'; iconOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  const busy = project.status === 'queued' || project.status === 'processing';
  const remove = useMutation({
    mutationFn: () => api(`/projects/${project.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setOpen(false);
      refreshAll(project.id);
      toast.success(busy ? 'Project deleted · the running step was stopped and refunded' : 'Project deleted');
      onDeleted?.();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <>
      <Button variant="outline" size={size} onClick={() => setOpen(true)} aria-label={`Delete ${project.title}`} title="Delete project">
        <Trash2 /> {iconOnly ? null : 'Delete'}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle className="text-lg font-semibold">Delete “{project.title}”?</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {busy ? 'Something is still running for this project. It will be stopped and its credits refunded. ' : ''}
            The project will be removed from your workspace. Uploaded and rendered videos stay in your Media Library.
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" loading={remove.isPending} onClick={() => remove.mutate()}>
              Delete project
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
