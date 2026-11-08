import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Lock, Save, Trash2 } from 'lucide-react';
import { CustomizeForm, StatusBadge, type CustomizeValue } from '@/components/app/projects';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, Field, Notice, Skeleton } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/overlays';
import { keys, queryClient, useProject } from '@/lib/queries';
import { api, errorMessage } from '@/lib/api';
import { modeName } from '@/config/options';
import { timeAgo } from '@/lib/utils';
import type { Project } from '@/types/api';

export default function ProjectDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: project, isLoading, isError, error } = useProject(id);

  const [title, setTitle] = useState('');
  const [script, setScript] = useState('');
  const [custom, setCustom] = useState<CustomizeValue | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!project) return;
    setTitle(project.title);
    setScript(project.script);
    setCustom({ style: project.style, aspectRatio: project.aspectRatio, settings: project.settings });
  }, [project]);

  const save = useMutation({
    mutationFn: () =>
      api<{ data: Project }>(`/projects/${id}`, {
        method: 'PATCH',
        body: { title: title.trim(), script, style: custom!.style, aspectRatio: custom!.aspectRatio, settings: custom!.settings },
      }).then((r) => r.data),
    onSuccess: (p) => {
      queryClient.setQueryData(keys.project(id), p);
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: keys.dashboard });
      toast.success('Changes saved');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: () => api(`/projects/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: keys.dashboard });
      toast.success('Project deleted');
      navigate('/app/projects', { replace: true });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (isLoading) {
    return (
      <div className="mx-auto grid max-w-4xl gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }
  if (isError || !project || !custom) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <p className="text-lg font-semibold">Project not found</p>
        <p className="mt-1 text-sm text-muted-foreground">{errorMessage(error)}</p>
        <Button asChild className="mt-6" variant="outline">
          <Link to="/app/projects">Back to projects</Link>
        </Button>
      </div>
    );
  }

  const dirty =
    title !== project.title ||
    script !== project.script ||
    JSON.stringify(custom) !== JSON.stringify({ style: project.style, aspectRatio: project.aspectRatio, settings: project.settings });

  return (
    <div className="mx-auto max-w-4xl">
      <Link to="/app/projects" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Projects
      </Link>
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="truncate text-2xl font-extrabold sm:text-3xl">{project.title}</h1>
            <StatusBadge status={project.status} />
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {modeName(project.mode)} · created {timeAgo(project.createdAt)} · last edited {timeAgo(project.updatedAt)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setConfirmDelete(true)}>
            <Trash2 /> Delete
          </Button>
          <Button variant="gradient" onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty || !title.trim()}>
            <Save /> Save
          </Button>
        </div>
      </div>

      <Notice tone="info" title="Draft" className="mb-6">
        Generation (transcription, editing and rendering) is coming in the next release. Everything you set here will be used when you generate.
        <Button variant="outline" size="sm" disabled className="ml-0 mt-3 block sm:ml-3 sm:mt-0 sm:inline-flex">
          <Lock /> Generate
        </Button>
      </Notice>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Content</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5">
            <Field id="title" label="Title" error={!title.trim() ? 'Title is required.' : undefined}>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
            </Field>
            {project.topic && <p className="text-sm"><span className="text-muted-foreground">Topic:</span> {project.topic}</p>}
            <Field id="script" label="Script / notes" hint={`${script.length.toLocaleString()} / 20,000`}>
              <Textarea value={script} onChange={(e) => setScript(e.target.value)} maxLength={20000} rows={8} />
            </Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Settings</CardTitle>
          </CardHeader>
          <CardContent>
            <CustomizeForm value={custom} onChange={setCustom} />
          </CardContent>
        </Card>
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogTitle className="text-lg font-semibold">Delete “{project.title}”?</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">The project will be removed from your workspace.</DialogDescription>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" loading={remove.isPending} onClick={() => remove.mutate()}>
              Delete project
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
