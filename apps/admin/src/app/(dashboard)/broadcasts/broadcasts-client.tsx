'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { PostStatus } from '@tgshop/db'
import {
  upsertBroadcastAction,
  sendBroadcastAction,
  cancelBroadcastAction,
  deleteBroadcastAction
} from '../../../lib/actions/broadcasts'
import { isBroadcastFrozen, isBroadcastCancellable, isBroadcastSendable } from '../../../lib/broadcasts-policy'
import type { BroadcastSegment } from '../../../lib/schemas'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { Select, Textarea } from '../../../components/ui/form'
import { Badge } from '../../../components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table'
import { formatDateTime, fromDateTimeLocalValue, toDateTimeLocalValue } from '../../../lib/format'
import { t } from '../../../lib/i18n'

export interface BroadcastStats {
  total: number
  sent: number
  blocked: number
  failed: number
}

export interface BroadcastRow {
  id: string
  text: string
  mediaUrl: string | null
  segment: string | null
  status: PostStatus
  scheduledAt: string | null
  sentAt: string | null
  createdAt: string
  stats: BroadcastStats | null
}

export interface SegmentOption {
  value: BroadcastSegment
  label: string
  count: number
  /** False when apps/worker has no branch for this segment and would reach nobody. */
  workerSupported: boolean
}

type BadgeTone = 'default' | 'success' | 'warning' | 'destructive' | 'secondary'

function statusVariant(status: PostStatus): BadgeTone {
  switch (status) {
    case PostStatus.SENT:
      return 'success'
    case PostStatus.SENDING:
      return 'warning'
    case PostStatus.QUEUED:
      return 'warning'
    case PostStatus.FAILED:
      return 'destructive'
    case PostStatus.CANCELLED:
      return 'destructive'
    case PostStatus.SCHEDULED:
      return 'default'
    default:
      return 'secondary'
  }
}

export function BroadcastsClient({
  posts,
  segments,
  canCompose,
  canDelete
}: {
  posts: BroadcastRow[]
  segments: SegmentOption[]
  canCompose: boolean
  canDelete: boolean
}) {
  const router = useRouter()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [mediaUrl, setMediaUrl] = useState('')
  const [segment, setSegment] = useState<BroadcastSegment | ''>('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const selected = segments.find((option) => option.value === segment)
  const reach = selected ? selected.count : (segments.find((option) => option.value === 'all')?.count ?? 0)

  function resetForm() {
    setEditingId(null)
    setText('')
    setMediaUrl('')
    setSegment('')
    setScheduledAt('')
    setError(null)
  }

  function startEdit(post: BroadcastRow) {
    setEditingId(post.id)
    setText(post.text)
    setMediaUrl(post.mediaUrl ?? '')
    setSegment((post.segment ?? '') as BroadcastSegment | '')
    setScheduledAt(toDateTimeLocalValue(post.scheduledAt))
    setMessage(null)
    setError(null)
  }

  /** Saves the draft, then optionally enqueues it (BullMQ applies the schedule delay). */
  async function save(enqueue: boolean) {
    if (!text.trim()) {
      setError('Message text is required')
      return
    }
    setPending(true)
    setError(null)
    setMessage(null)
    try {
      const saved = await upsertBroadcastAction({
        id: editingId ?? undefined,
        text,
        mediaUrl: mediaUrl.trim() ? mediaUrl.trim() : null,
        segment: segment === '' ? null : segment,
        scheduledAt: fromDateTimeLocalValue(scheduledAt)
      })
      if (enqueue) {
        await sendBroadcastAction({ id: saved.id })
        setMessage(
          saved.scheduledAt
            ? `Queued — delivery starts ${formatDateTime(saved.scheduledAt)} UTC`
            : `Queued for delivery to ~${reach} user(s)`
        )
      } else {
        setMessage(scheduledAt ? 'Saved as scheduled (not queued yet)' : 'Saved as draft')
      }
      resetForm()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setPending(false)
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    await save(false)
  }

  async function onSendExisting(post: BroadcastRow) {
    const when = post.scheduledAt ? `at ${formatDateTime(post.scheduledAt)} UTC` : 'right now'
    if (!window.confirm(`Queue this broadcast for delivery ${when}?`)) return
    setPending(true)
    setError(null)
    setMessage(null)
    try {
      await sendBroadcastAction({ id: post.id })
      setMessage('Broadcast queued')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setPending(false)
    }
  }

  async function onCancel(post: BroadcastRow) {
    if (!window.confirm('Pull this broadcast back out of the queue? Nothing has been sent yet.')) return
    setPending(true)
    setError(null)
    setMessage(null)
    try {
      await cancelBroadcastAction({ id: post.id })
      setMessage('Broadcast cancelled — edit and re-queue it when ready')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setPending(false)
    }
  }

  async function onDelete(id: string) {
    if (!window.confirm('Delete this broadcast?')) return
    setPending(true)
    setError(null)
    try {
      await deleteBroadcastAction(id)
      if (editingId === id) resetForm()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {canCompose && (
        <Card>
          <CardHeader>
            <CardTitle>{editingId ? 'Edit broadcast' : t('broadcasts.compose')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <Label htmlFor="text">Message</Label>
                <Textarea
                  id="text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  maxLength={4096}
                  required
                  className="min-h-[140px]"
                  placeholder="Text sent to every recipient."
                />
                <span className="text-xs text-muted-foreground">{text.length} / 4096</span>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="mediaUrl">Media URL (optional)</Label>
                  <Input
                    id="mediaUrl"
                    type="url"
                    value={mediaUrl}
                    onChange={(e) => setMediaUrl(e.target.value)}
                    placeholder="https://…"
                  />
                  <span className="text-xs text-muted-foreground">Appended to the message as a trailing link.</span>
                </div>

                <div className="flex flex-col gap-1">
                  <Label htmlFor="segment">Segment</Label>
                  <Select
                    id="segment"
                    value={segment}
                    onChange={(e) => setSegment(e.target.value as BroadcastSegment | '')}
                  >
                    <option value="">{t('broadcasts.segment.all')} (default)</option>
                    {segments.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label} — {option.count}
                      </option>
                    ))}
                  </Select>
                  <span className="text-xs text-muted-foreground">Reaches ~{reach} non-blocked user(s).</span>
                  {selected && !selected.workerSupported && (
                    <span className="text-xs text-destructive">
                      The delivery worker has no branch for “{selected.value}” yet and would reach 0 users. Pick another
                      segment until it is implemented.
                    </span>
                  )}
                </div>

                <div className="flex flex-col gap-1">
                  <Label htmlFor="scheduledAt">Schedule (UTC, optional)</Label>
                  <Input
                    id="scheduledAt"
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                  />
                  <span className="text-xs text-muted-foreground">Empty = send as soon as it is queued.</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" variant="outline" disabled={pending}>
                  {t('common.save')}
                </Button>
                <Button type="button" onClick={() => void save(true)} disabled={pending}>
                  {scheduledAt ? t('broadcasts.schedule') : t('broadcasts.sendNow')}
                </Button>
                {editingId && (
                  <Button type="button" variant="outline" onClick={resetForm} disabled={pending}>
                    {t('common.cancel')}
                  </Button>
                )}
                {message && <span className="text-sm text-success">{message}</span>}
                {error && <span className="text-sm text-destructive">{error}</span>}
              </div>
              <p className="text-xs text-muted-foreground">
                Saving alone only stores the post. Nothing is delivered until it is queued, including scheduled posts.
              </p>
            </form>
          </CardContent>
        </Card>
      )}

      {!canCompose && error && <p className="text-sm text-destructive">{error}</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Created</TableHead>
            <TableHead>Message</TableHead>
            <TableHead>Segment</TableHead>
            <TableHead>{t('common.status')}</TableHead>
            <TableHead>Scheduled</TableHead>
            <TableHead>Sent</TableHead>
            <TableHead>Delivery</TableHead>
            <TableHead>{t('common.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {posts.map((post) => {
            const frozen = isBroadcastFrozen(post.status)
            const cancellable = isBroadcastCancellable(post.status)
            const sendable = isBroadcastSendable(post.status)
            return (
              <TableRow key={post.id}>
                <TableCell className="whitespace-nowrap">{formatDateTime(post.createdAt)}</TableCell>
                <TableCell className="max-w-sm">
                  <span className="line-clamp-2 whitespace-pre-wrap break-words">{post.text}</span>
                  {post.mediaUrl && (
                    <span className="mt-1 block truncate font-mono text-xs text-muted-foreground">{post.mediaUrl}</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{post.segment ?? 'all'}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant(post.status)}>{post.status}</Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap">{formatDateTime(post.scheduledAt)}</TableCell>
                <TableCell className="whitespace-nowrap">{formatDateTime(post.sentAt)}</TableCell>
                <TableCell className="tabular-nums text-xs">
                  {post.stats ? (
                    <span className="flex flex-col">
                      <span className="text-success">sent {post.stats.sent}</span>
                      <span className="text-muted-foreground">of {post.stats.total}</span>
                      {(post.stats.blocked > 0 || post.stats.failed > 0) && (
                        <span className="text-destructive">
                          blocked {post.stats.blocked} · failed {post.stats.failed}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="flex flex-wrap gap-2">
                  {canCompose && !frozen && (
                    <Button size="sm" variant="outline" onClick={() => startEdit(post)} disabled={pending}>
                      {t('common.edit')}
                    </Button>
                  )}
                  {canCompose && sendable && (
                    <Button size="sm" onClick={() => void onSendExisting(post)} disabled={pending}>
                      {post.scheduledAt ? t('broadcasts.schedule') : t('broadcasts.sendNow')}
                    </Button>
                  )}
                  {canCompose && cancellable && (
                    <Button size="sm" variant="outline" onClick={() => void onCancel(post)} disabled={pending}>
                      {t('common.cancel')}
                    </Button>
                  )}
                  {canDelete && !frozen && (
                    <Button size="sm" variant="destructive" onClick={() => void onDelete(post.id)} disabled={pending}>
                      {t('common.delete')}
                    </Button>
                  )}
                  {frozen && <span className="text-xs text-muted-foreground">locked</span>}
                </TableCell>
              </TableRow>
            )
          })}
          {posts.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-muted-foreground">
                {t('common.noResults')}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
