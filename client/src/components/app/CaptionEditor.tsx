import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Input, Select } from '../ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Notice } from '../ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { keys, queryClient } from '@/lib/queries';
import type { CaptionLineData, Project } from '@/types/api';

const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
};

/** Client-side checks mirroring the server: order, no overlaps, keyword present, text not empty. */
function validate(lines: CaptionLineData[]): string | null {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (!l.text.trim()) return `Line ${i + 1} is empty.`;
    if (l.end <= l.start) return `Line ${i + 1} ends before it starts.`;
    const prev = lines[i - 1];
    if (prev && l.start < prev.end - 0.001) return `Line ${i + 1} overlaps the line before it.`;
    if (l.keyword && !l.text.toLowerCase().includes(l.keyword.toLowerCase())) return `Line ${i + 1}: the highlighted word isn’t in the line.`;
  }
  return null;
}

/**
 * Edit the captions of the last render: wording, highlighted word, timing, or remove lines.
 * Saved edits are used exactly as written on the next render, as long as the cut is unchanged.
 */
export function CaptionEditor({ project }: { project: Project }) {
  // Show saved edits when there are any; otherwise the captions from the last render.
  const source = useMemo(() => project.captionOverrides ?? project.captionLines ?? [], [project.captionOverrides, project.captionLines]);
  const [lines, setLines] = useState<CaptionLineData[]>(source);
  useEffect(() => setLines(source), [source]);

  const dirty = JSON.stringify(lines) !== JSON.stringify(source);
  const error = validate(lines);
  const onSaved = (p: Project) => {
    queryClient.setQueryData(keys.project(project.id), p);
  };

  const save = useMutation({
    mutationFn: () => api<{ data: Project }>(`/projects/${project.id}/captions`, { method: 'PUT', body: { lines } }).then((r) => r.data),
    onSuccess: (p) => {
      onSaved(p);
      toast.success('Caption edits saved — click “Render again” to apply them');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const reset = useMutation({
    mutationFn: () => api<{ data: Project }>(`/projects/${project.id}/captions`, { method: 'DELETE' }).then((r) => r.data),
    onSuccess: (p) => {
      onSaved(p);
      toast.success('Edits discarded — captions will be generated again on the next render');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!source.length) return null;
  const update = (i: number, patch: Partial<CaptionLineData>) =>
    setLines((ls) =>
      ls.map((l, j) => {
        if (j !== i) return l;
        const next = { ...l, ...patch };
        // Keep the highlight valid when the wording changes.
        if (patch.text !== undefined && next.keyword && !next.text.toLowerCase().includes(next.keyword.toLowerCase())) next.keyword = '';
        return next;
      }),
    );

  return (
    <Card>
      <CardHeader className="sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Edit captions</CardTitle>
          <CardDescription className="mt-1.5">
            Fix wording, change the highlighted word, adjust timing or remove a line. Edits are used exactly as written on your next render
            {project.renderStats?.captionsTranslatedTo ? ' (including translated captions)' : ''}.
          </CardDescription>
        </div>
        <div className="flex shrink-0 gap-2">
          {project.captionsEdited && (
            <Button variant="ghost" size="sm" onClick={() => reset.mutate()} loading={reset.isPending}>
              <RotateCcw /> Discard edits
            </Button>
          )}
          <Button size="sm" variant="gradient" disabled={!dirty || Boolean(error)} loading={save.isPending} onClick={() => save.mutate()}>
            <Save /> Save edits
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        {project.captionsEdited && !dirty && <Notice tone="success">Your edits are saved and will be used on the next render.</Notice>}
        {error && dirty && <Notice tone="error">{error}</Notice>}
        <ul className="grid max-h-[460px] gap-2 overflow-y-auto pr-1">
          {lines.map((l, i) => {
            const words = l.text.split(/\s+/).filter(Boolean);
            return (
              <li key={i} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[150px_1fr_150px_auto] sm:items-center">
                <div className="flex items-center gap-1 text-xs">
                  <Input
                    aria-label={`Line ${i + 1} start (seconds)`}
                    type="number"
                    step={0.05}
                    min={0}
                    value={l.start}
                    onChange={(e) => update(i, { start: Math.max(0, Number(e.target.value)) })}
                    className="h-8 px-2 text-xs"
                  />
                  <span className="text-muted-foreground">–</span>
                  <Input
                    aria-label={`Line ${i + 1} end (seconds)`}
                    type="number"
                    step={0.05}
                    min={0}
                    value={l.end}
                    onChange={(e) => update(i, { end: Math.max(0, Number(e.target.value)) })}
                    className="h-8 px-2 text-xs"
                  />
                </div>
                <Input aria-label={`Line ${i + 1} text`} value={l.text} maxLength={160} onChange={(e) => update(i, { text: e.target.value })} />
                <Select aria-label={`Line ${i + 1} highlighted word`} value={l.keyword} onChange={(e) => update(i, { keyword: e.target.value })} className="h-9 text-xs">
                  <option value="">No highlight</option>
                  {words.map((w, k) => (
                    <option key={`${w}-${k}`} value={w}>
                      {w}
                    </option>
                  ))}
                </Select>
                <div className="flex items-center justify-between gap-2 sm:justify-end">
                  <span className="text-[11px] text-muted-foreground sm:hidden">
                    {fmt(l.start)}–{fmt(l.end)}
                  </span>
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Delete line ${i + 1}`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                    <Trash2 />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const last = lines[lines.length - 1];
              const start = last ? last.end + 0.05 : 0;
              setLines((ls) => [...ls, { start: Math.round(start * 100) / 100, end: Math.round((start + 1.5) * 100) / 100, text: 'New caption', keyword: '' }]);
            }}
          >
            <Plus /> Add line
          </Button>
          <p className="text-xs text-muted-foreground">Times are seconds on the edited video. If you later change the editing intensity, saved edits are set aside so they never drift out of sync.</p>
        </div>
      </CardContent>
    </Card>
  );
}
