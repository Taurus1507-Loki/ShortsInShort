import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Download, Film, Play, Trash2, Upload } from 'lucide-react';
import { PageHeader } from '@/components/app/AppLayout';
import { VideoUploader } from '@/components/app/VideoUploader';
import { Button } from '@/components/ui/button';
import { Badge, Card, Notice, Skeleton } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/overlays';
import { useAuth } from '@/features/auth/AuthProvider';
import { keys, queryClient, useAssets, useAssetUrl } from '@/lib/queries';
import { api, errorMessage } from '@/lib/api';
import { formatDuration } from '@/lib/upload';
import { formatBytes, timeAgo } from '@/lib/utils';
import type { Asset } from '@/types/api';

function Thumb({ asset }: { asset: Asset }) {
  const thumb = useAssetUrl(asset.thumbnailAssetId);
  return thumb.data ? (
    <img src={thumb.data} alt="" className="h-full w-full object-cover" loading="lazy" />
  ) : (
    <Film className="h-8 w-8 text-muted-foreground" />
  );
}

function PreviewDialog({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const url = useAssetUrl(asset.id);
  const portrait = (asset.height ?? 0) > (asset.width ?? 0);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={portrait ? 'max-w-sm' : 'max-w-3xl'}>
        <DialogTitle className="truncate pr-8 text-base font-semibold">{asset.originalName}</DialogTitle>
        <DialogDescription className="sr-only">Video preview</DialogDescription>
        {url.data ? (
          <video src={url.data} controls autoPlay playsInline className="max-h-[70vh] w-full rounded-lg bg-black" style={{ aspectRatio: `${asset.width} / ${asset.height}` }} />
        ) : (
          <Skeleton className="aspect-video w-full" />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AssetCard({ asset, onPreview, onDelete }: { asset: Asset; onPreview: () => void; onDelete: () => void }) {
  const download = useAssetUrl(asset.id, true);
  return (
    <Card className="flex flex-col overflow-hidden">
      <button onClick={onPreview} className="group relative grid aspect-video place-items-center overflow-hidden bg-muted/40" aria-label={`Preview ${asset.originalName}`}>
        <Thumb asset={asset} />
        <span className="absolute inset-0 grid place-items-center bg-black/0 transition-colors group-hover:bg-black/40">
          <Play className="h-8 w-8 text-white opacity-0 transition-opacity group-hover:opacity-100" />
        </span>
        <span className="absolute left-2 top-2">
          <Badge variant={asset.kind === 'render' ? 'success' : 'muted'}>{asset.kind === 'render' ? 'Rendered' : 'Upload'}</Badge>
        </span>
        {asset.durationSec != null && (
          <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-xs font-medium text-white">{formatDuration(asset.durationSec)}</span>
        )}
      </button>
      <div className="flex flex-1 flex-col gap-1 p-3.5">
        <p className="truncate text-sm font-semibold" title={asset.originalName}>
          {asset.originalName || 'Untitled'}
        </p>
        <p className="text-xs text-muted-foreground">
          {asset.width}×{asset.height} · {formatBytes(asset.sizeBytes)} · {timeAgo(asset.createdAt)}
        </p>
        <div className="mt-2 flex items-center gap-1">
          {asset.projectId && (
            <Button asChild size="sm" variant="ghost">
              <Link to={`/app/projects/${asset.projectId}`}>Project</Link>
            </Button>
          )}
          <Button asChild size="icon" variant="ghost" className="ml-auto h-8 w-8" aria-label="Download">
            <a href={download.data ?? '#'} download>
              <Download />
            </a>
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onDelete} aria-label="Delete">
            <Trash2 />
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default function MediaLibraryPage() {
  const { user, workspace } = useAuth();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const { data, isLoading, isError, error } = useAssets(page);
  const [preview, setPreview] = useState<Asset | null>(null);
  const [toDelete, setToDelete] = useState<Asset | null>(null);
  const [showUpload, setShowUpload] = useState(false);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['assets'] });
    queryClient.invalidateQueries({ queryKey: keys.me });
    queryClient.invalidateQueries({ queryKey: keys.dashboard });
  };

  const remove = useMutation({
    mutationFn: (a: Asset) => api(`/assets/${a.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setToDelete(null);
      refresh();
      toast.success('Deleted');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <>
      <PageHeader
        title="Media Library"
        description={workspace ? `${formatBytes(workspace.storageBytesUsed)} of ${formatBytes(workspace.storageBytesLimit)} used · stored privately` : undefined}
        actions={
          user?.emailVerified ? (
            <Button onClick={() => setShowUpload((s) => !s)}>
              <Upload /> Upload video
            </Button>
          ) : undefined
        }
      />

      {showUpload && (
        <Card className="mb-6 p-5">
          <VideoUploader
            compact
            onUploaded={() => {
              setShowUpload(false);
              refresh();
              toast.success('Video uploaded');
            }}
          />
        </Card>
      )}

      {isError && <Notice tone="error">{errorMessage(error)}</Notice>}

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-60 rounded-xl" />
          ))}
        </div>
      ) : data && data.data.length > 0 ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {data.data.map((a) => (
              <AssetCard key={a.id} asset={a} onPreview={() => setPreview(a)} onDelete={() => setToDelete(a)} />
            ))}
          </div>
          {data.meta.totalPages > 1 && (
            <nav className="mt-8 flex items-center justify-center gap-3" aria-label="Pagination">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setParams({ page: String(page - 1) })}>
                <ChevronLeft /> Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {data.meta.totalPages}
              </span>
              <Button variant="outline" size="sm" disabled={page >= data.meta.totalPages} onClick={() => setParams({ page: String(page + 1) })}>
                Next <ChevronRight />
              </Button>
            </nav>
          )}
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <Film className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-semibold">No media yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Uploaded footage and rendered videos appear here.</p>
        </div>
      )}

      {preview && <PreviewDialog asset={preview} onClose={() => setPreview(null)} />}

      <Dialog open={Boolean(toDelete)} onOpenChange={(o) => !o && setToDelete(null)}>
        <DialogContent>
          <DialogTitle className="text-lg font-semibold">Delete “{toDelete?.originalName}”?</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            The file is permanently removed from storage and can’t be recovered.
            {toDelete?.kind === 'source_video' && ' Projects using it will need a new upload before rendering.'}
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setToDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" loading={remove.isPending} onClick={() => toDelete && remove.mutate(toDelete)}>
              Delete permanently
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
