import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError, errorText } from './api';
import { useRefresh } from './hooks';
import type { Command, CommandBody, Me, SupportEvent } from './types';
import { Badge, label, when } from './ui';
type Attempt = { command: Command; body: CommandBody; version: number; key: string };
const resolutions = [
  'INFORMATION_PROVIDED',
  'ACTION_COMPLETED',
  'DUPLICATE',
  'WITHDRAWN',
  'NO_ACTION_REQUIRED',
];
export function RequestDetail() {
  const { id = '' } = useParams();
  return <DetailScreen key={id} id={id} />;
}
function DetailScreen({ id }: { id: string }) {
  const me = useOutletContext<Me>(),
    [params] = useSearchParams();
  const manager = me.roles.includes('support_manager') && me.permissions.includes('support:manage');
  const reads = useRefresh(id, async () => {
    const [detail, history, agents] = await Promise.all([
      api.detail(id),
      api.history(id),
      api.agents(manager),
    ]);
    return { detail, history, agents };
  });
  const row = reads.data?.detail;
  const [older, setOlder] = useState<SupportEvent[]>([]),
    [before, setBefore] = useState<number | null>(null),
    [historyError, setHistoryError] = useState(''),
    [historyBusy, setHistoryBusy] = useState(false);
  const historyInitialized = useRef(false);
  useEffect(() => {
    if (reads.data) {
      setOlder((old) =>
        [...old, ...reads.data!.history.items].filter(
          (event, index, array) => array.findIndex((item) => item.id === event.id) === index,
        ),
      );
      if (!historyInitialized.current) {
        setBefore(reads.data.history.nextBeforeVersion);
        historyInitialized.current = true;
      }
    }
  }, [reads.data]);
  const [publicDraft, setPublicDraft] = useState(''),
    [privateDraft, setPrivateDraft] = useState(''),
    [awaitReply, setAwaitReply] = useState(false);
  const [action, setAction] = useState<Command>('resolve'),
    [explanation, setExplanation] = useState(''),
    [reason, setReason] = useState(''),
    [target, setTarget] = useState(''),
    [resolution, setResolution] = useState(resolutions[0]),
    [waiting, setWaiting] = useState('CENTER'),
    [priority, setPriority] = useState('HIGH');
  const [busy, setBusy] = useState(false),
    [commandError, setCommandError] = useState(''),
    [saved, setSaved] = useState(''),
    [stale, setStale] = useState(false),
    [pending, setPending] = useState<Attempt | null>(null);
  const inFlight = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const active = row?.status === 'OPEN' || row?.status === 'IN_PROGRESS';
  const work = me.permissions.includes('support:work');
  const owns = row?.status === 'IN_PROGRESS' && (row.assignee?.id === me.id || manager);
  const canWork = work && owns;
  const disabled = busy || stale || !!pending;
  async function run(command: Command, body: CommandBody, retry?: Attempt) {
    if (!row || inFlight.current || (!retry && (stale || pending))) return;
    const attempt = retry ?? { command, body, version: row.version, key: crypto.randomUUID() };
    inFlight.current = true;
    setBusy(true);
    setCommandError('');
    setSaved('');
    try {
      const receipt = await api.command(
        id,
        attempt.command,
        attempt.body,
        attempt.version,
        attempt.key,
      );
      if (!mounted.current) return;
      setPending(null);
      setSaved(`${label(attempt.command)} saved · version ${receipt.version}`);
      if (attempt.command === 'replies') setPublicDraft('');
      if (attempt.command === 'notes') setPrivateDraft('');
      if (['resolve', 'close', 'reopen'].includes(attempt.command)) setExplanation('');
      setReason('');
      // The command has succeeded even if this subsequent read fails.
      await reads.refresh().catch(() => undefined);
    } catch (err) {
      if (!mounted.current) return;
      const uncertain = !(err instanceof ApiError) || err.status === 0 || err.status >= 500;
      setPending(uncertain ? attempt : null);
      setCommandError(
        uncertain
          ? 'The result could not be confirmed. Retry the same command to recover its receipt.'
          : errorText(err),
      );
      if (err instanceof ApiError && err.status === 409) setStale(true);
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function refresh() {
    try {
      await reads.refresh();
      setStale(false);
      setCommandError('');
    } catch {
      /* read error is shown independently */
    }
  }
  async function more() {
    if (!before || historyBusy) return;
    setHistoryBusy(true);
    setHistoryError('');
    try {
      const page = await api.history(id, before);
      setOlder((old) => [...page.items, ...old]);
      setBefore(page.nextBeforeVersion);
    } catch (err) {
      setHistoryError(errorText(err));
    } finally {
      setHistoryBusy(false);
    }
  }
  function handleAction(event: FormEvent) {
    event.preventDefault();
    let body: CommandBody = {};
    if (selected === 'assign')
      body = {
        assignedAgentProfileId: target,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      };
    if (selected === 'release') body = { reason: reason.trim() };
    if (selected === 'wait')
      body = { waitingOn: waiting === 'NONE' ? null : waiting, reason: reason.trim() };
    if (selected === 'priority') body = { priority, reason: reason.trim() };
    if (['resolve', 'close', 'reopen'].includes(selected))
      body = {
        message: explanation.trim(),
        ...(selected === 'resolve' ? { resolutionCode: resolution } : {}),
      };
    void run(selected, body);
  }
  const back = params.get('returnTo') ?? '/requests';
  const backTo = /^\/requests(?:\?[^#]*)?$/.test(back) ? back : '/requests';
  if (!row)
    return (
      <main>
        <Link to={backTo}>← Back to queue</Link>
        <h1>{reads.busy ? 'Loading request…' : 'Request unavailable'}</h1>
        {reads.error ? (
          <p role="alert" className="error">
            {reads.error}
          </p>
        ) : null}
        <button onClick={() => void refresh()}>Retry</button>
      </main>
    );
  const events = [...older, ...(reads.data?.history.items ?? [])]
    .filter((event, index, array) => array.findIndex((item) => item.id === event.id) === index)
    .sort((a, b) => a.version - b.version);
  const actions: Command[] = [
    ...(canWork ? (['resolve', 'wait', 'priority', 'release'] as Command[]) : []),
    ...(manager && active ? (['assign'] as Command[]) : []),
    ...(manager && row.status === 'RESOLVED' ? (['close'] as Command[]) : []),
    ...(manager && ['CLOSED', 'RESOLVED'].includes(row.status) ? (['reopen'] as Command[]) : []),
  ];
  const selected = actions.includes(action) ? action : actions[0];
  return (
    <main>
      <Link className="back" to={backTo}>
        ← Back to queue
      </Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            {row.referenceNumber} · {label(row.category)}
          </p>
          <h1>{row.subject}</h1>
          <div className="badges">
            <Badge>{label(row.status)}</Badge>
            <Badge tone={row.priority === 'HIGH' ? 'high' : 'normal'}>
              {label(row.priority)} priority
            </Badge>
            {row.needsReply ? <Badge tone="high">Needs support reply</Badge> : null}
            {row.waitingOn ? <Badge>Waiting on {label(row.waitingOn).toLowerCase()}</Badge> : null}
          </div>
        </div>
        <div className="refresh">
          <button disabled={busy || reads.busy} onClick={() => void refresh()}>
            {reads.busy ? 'Refreshing…' : 'Refresh request'}
          </button>
          <small>
            Version {row.version} · {reads.updated ? when(reads.updated.toISOString()) : ''}
          </small>
        </div>
      </div>
      {saved ? (
        <p className="success" role="status">
          {saved}
        </p>
      ) : null}
      {commandError ? (
        <section className="error" role="alert">
          <p>{commandError}</p>
          {stale ? (
            <>
              <p>Your draft is kept. Refresh, review the latest conversation, then send again.</p>
              <button onClick={() => void refresh()} disabled={busy || reads.busy}>
                Refresh and review
              </button>
            </>
          ) : null}
          {pending ? (
            <>
              <p>
                Pending: {label(pending.command)}. Other commands are paused until its result is
                confirmed.
              </p>
              <button
                disabled={busy}
                onClick={() => void run(pending.command, pending.body, pending)}
              >
                {busy ? 'Confirming…' : 'Retry same command'}
              </button>
            </>
          ) : null}
        </section>
      ) : null}
      {reads.error ? (
        <p className="error" role="alert">
          {saved ? 'Saved successfully; could not refresh: ' : ''}
          {reads.error} <button onClick={() => void refresh()}>Retry refresh</button>
        </p>
      ) : null}
      <div className="detail-grid">
        <div>
          <section className="panel">
            <h2>Conversation & history</h2>
            <p className="muted">
              Public messages are visible to the customer. Private notes and handling changes stay
              in this desk.
            </p>
            {before ? (
              <button onClick={() => void more()} disabled={historyBusy}>
                {historyBusy ? 'Loading history…' : 'Load older history'}
              </button>
            ) : null}
            {historyError ? (
              <p role="alert" className="error">
                {historyError}
              </p>
            ) : null}
            <article className="history-entry public">
              <div>
                <strong>Customer</strong>
                <Badge>Original request</Badge>
                <time>{when(row.createdAt)}</time>
              </div>
              <p>{row.message}</p>
            </article>
            {events
              .filter((event) => event.type !== 'CREATED')
              .map((event) => (
                <article
                  className={`history-entry ${event.visibility.toLowerCase()}`}
                  key={event.id}
                >
                  <div>
                    <strong>{event.author}</strong>
                    <Badge tone={event.visibility === 'INTERNAL' ? 'private' : 'normal'}>
                      {event.visibility === 'INTERNAL' ? 'Private · ' : ''}
                      {label(event.type)}
                    </Badge>
                    <time>
                      {when(event.createdAt)} · v{event.version}
                    </time>
                  </div>
                  {event.body ? <p>{event.body}</p> : null}
                  {event.changes &&
                  Object.keys(event.changes).some((key) =>
                    ['status', 'priority', 'waitingOn', 'assignedAgentProfileId'].includes(key),
                  ) ? (
                    <dl className="change-list">
                      {Object.entries(event.changes)
                        .filter(([key]) =>
                          ['status', 'priority', 'waitingOn', 'assignedAgentProfileId'].includes(
                            key,
                          ),
                        )
                        .map(([key, value]) => (
                          <div key={key}>
                            <dt>
                              {key === 'assignedAgentProfileId'
                                ? 'Owner'
                                : label(key.replace(/([A-Z])/g, '_$1'))}
                            </dt>
                            <dd>
                              {formatChange(value.before, key)} → {formatChange(value.after, key)}
                            </dd>
                          </div>
                        ))}
                    </dl>
                  ) : null}
                </article>
              ))}
          </section>
          {canWork ? (
            <div className="composer-grid">
              <form
                className="panel"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run('replies', {
                    message: publicDraft.trim(),
                    awaitCustomerReply: awaitReply,
                  });
                }}
              >
                <h2>Reply to customer</h2>
                <p className="muted">Visible in Help & Support</p>
                <label>
                  Public reply
                  <textarea
                    required
                    maxLength={4000}
                    value={publicDraft}
                    disabled={!!pending}
                    onChange={(event) => setPublicDraft(event.target.value)}
                  />
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={awaitReply}
                    onChange={(event) => setAwaitReply(event.target.checked)}
                    disabled={!!pending}
                  />
                  Wait for a customer reply
                </label>
                <button className="primary" disabled={disabled || !publicDraft.trim()}>
                  Send public reply
                </button>
              </form>
              <form
                className="panel private-panel"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run('notes', { message: privateDraft.trim() });
                }}
              >
                <h2>Private note</h2>
                <p className="muted">Only support operators can read this</p>
                <label>
                  Internal note
                  <textarea
                    required
                    maxLength={4000}
                    value={privateDraft}
                    disabled={!!pending}
                    onChange={(event) => setPrivateDraft(event.target.value)}
                  />
                </label>
                <button disabled={disabled || !privateDraft.trim()}>Save private note</button>
              </form>
            </div>
          ) : null}
          {row.status === 'OPEN' && work ? (
            <section className="panel">
              <h2>Start handling</h2>
              <p>Claim this request to reply and record work.</p>
              <button className="primary" disabled={disabled} onClick={() => void run('claim', {})}>
                Claim request
              </button>
            </section>
          ) : null}
          {row.status === 'IN_PROGRESS' && !owns ? (
            <p className="muted">
              Assigned to {row.assignee?.displayName}. A manager can reassign this request.
            </p>
          ) : null}
          {actions.length ? (
            <form className="panel" onSubmit={handleAction}>
              <h2>Next step</h2>
              <label>
                Action
                <select
                  value={selected}
                  onChange={(event) => {
                    setAction(event.target.value as Command);
                    setSaved('');
                  }}
                  disabled={disabled}
                >
                  {actions.map((value) => (
                    <option key={value} value={value}>
                      {label(value)}
                    </option>
                  ))}
                </select>
              </label>
              {selected === 'assign' ? (
                <label>
                  Assign to
                  <select
                    required
                    value={target}
                    onChange={(event) => setTarget(event.target.value)}
                    disabled={disabled}
                  >
                    <option value="">Choose an active operator</option>
                    {reads.data?.agents
                      .filter((agent) => agent.isActive && agent.id !== row.assignee?.id)
                      .map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.displayName}
                        </option>
                      ))}
                  </select>
                </label>
              ) : null}
              {selected === 'resolve' ? (
                <label>
                  Resolution
                  <select
                    value={resolution}
                    onChange={(event) => setResolution(event.target.value)}
                    disabled={disabled}
                  >
                    {resolutions.map((value) => (
                      <option key={value} value={value}>
                        {label(value)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {selected === 'wait' ? (
                <label>
                  Wait for
                  <select
                    value={waiting}
                    onChange={(event) => setWaiting(event.target.value)}
                    disabled={disabled}
                  >
                    <option value="CENTER">Center</option>
                    <option value="INTERNAL">Internal team</option>
                    <option value="NONE">Clear waiting state</option>
                  </select>
                </label>
              ) : null}
              {selected === 'priority' ? (
                <label>
                  Priority
                  <select
                    value={priority}
                    onChange={(event) => setPriority(event.target.value)}
                    disabled={disabled}
                  >
                    <option value="HIGH">High</option>
                    <option value="NORMAL">Normal</option>
                  </select>
                </label>
              ) : null}
              {['resolve', 'close', 'reopen'].includes(selected) ? (
                <>
                  <p className="muted">
                    This explanation will be visible to the customer.
                    {selected === 'close' ? ' Closing prevents further customer replies.' : ''}
                  </p>
                  <label>
                    Public explanation
                    <textarea
                      required
                      minLength={10}
                      maxLength={4000}
                      value={explanation}
                      onChange={(event) => setExplanation(event.target.value)}
                      disabled={disabled}
                    />
                  </label>
                </>
              ) : (
                <label>
                  Private reason {selected === 'assign' && !row.assignee ? '(optional)' : ''}
                  <textarea
                    required={selected !== 'assign' || !!row.assignee}
                    minLength={3}
                    maxLength={1000}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    disabled={disabled}
                  />
                </label>
              )}
              <button className="primary" disabled={disabled}>
                {busy ? 'Saving…' : `${label(selected)} request`}
              </button>
            </form>
          ) : null}
        </div>
        <aside>
          <section className="panel">
            <h2>Owner & timing</h2>
            <dl>
              <dt>Assigned to</dt>
              <dd>
                {row.assignee?.displayName ?? 'Unassigned'}
                {row.assignee && !row.assignee.isActive ? (
                  <span className="attention"> · inactive</span>
                ) : null}
              </dd>
              <dt>Created</dt>
              <dd>{when(row.createdAt)}</dd>
              <dt>Last activity</dt>
              <dd>{when(row.lastActivityAt)}</dd>
              <dt>First response</dt>
              <dd>{row.firstResponseAt ? when(row.firstResponseAt) : 'No recorded response'}</dd>
              <dt>Last customer message</dt>
              <dd>{when(row.lastCustomerMessageAt)}</dd>
            </dl>
          </section>
          <section className="panel">
            <h2>Requester</h2>
            <dl>
              <dt>Name</dt>
              <dd>{row.customer?.displayName ?? 'Not provided'}</dd>
              <dt>Phone</dt>
              <dd>{row.customer?.phone ?? 'Not provided'}</dd>
              <dt>Email</dt>
              <dd>{row.customer?.email ?? 'Not provided'}</dd>
              <dt>Requested channel</dt>
              <dd>{row.preferredChannel ?? row.customer?.preferredChannel ?? 'Not provided'}</dd>
              <dt>Consent</dt>
              <dd>
                WhatsApp: {row.customer?.whatsappConsent ? 'Yes' : 'No'} · Email:{' '}
                {row.customer?.emailConsent ? 'Yes' : 'No'}
              </dd>
            </dl>
            <p className="muted">
              Replies are stored in Help & Support. Outbound delivery is simulated in local mode.
            </p>
          </section>
          <section className="panel">
            <h2>Linked visit</h2>
            {row.linkedContext.state === 'NONE' ? (
              <p>Account or app request. No visit linked.</p>
            ) : null}
            {row.linkedContext.state === 'NEEDS_REVIEW' ? (
              <p className="attention">
                The stored links need review. Visit context is unavailable.
              </p>
            ) : null}
            {row.linkedContext.booking ? (
              <>
                <h3>{row.linkedContext.booking.reference}</h3>
                <p>
                  {row.linkedContext.booking.centerName}
                  <br />
                  {row.linkedContext.booking.vehicleLabel} ·{' '}
                  {row.linkedContext.booking.registration}
                  <br />
                  {label(row.linkedContext.booking.status)} ·{' '}
                  {when(row.linkedContext.booking.slotStart)}
                  <br />
                  Estimate ₹{row.linkedContext.booking.estimateInr}
                </p>
              </>
            ) : null}
            {row.linkedContext.job ? (
              <>
                <h3>{row.linkedContext.job.reference ?? 'Service job'}</h3>
                <p>
                  {row.linkedContext.job.centerName}
                  <br />
                  {row.linkedContext.job.vehicleLabel} · {row.linkedContext.job.registration}
                  <br />
                  {label(row.linkedContext.job.status)}
                  <br />
                  Agreed work ₹{row.linkedContext.job.currentAmountInr}
                  <br />
                  Final ₹{row.linkedContext.job.finalAmountInr ?? 'Not recorded'}
                </p>
                {row.linkedContext.job.invoice ? (
                  <p>
                    Invoice {row.linkedContext.job.invoice.reference}
                    <br />₹{row.linkedContext.job.invoice.totalInr} ·{' '}
                    {label(row.linkedContext.job.invoice.status)}
                  </p>
                ) : null}
              </>
            ) : null}
          </section>
          {row.resolutionSummary || row.closureSummary || row.legacyResolutionUnknown ? (
            <section className="panel">
              <h2>Outcome</h2>
              {row.resolutionSummary ? <p>{row.resolutionSummary}</p> : null}
              {row.closureSummary ? <p>{row.closureSummary}</p> : null}
              {row.legacyResolutionUnknown ? (
                <p>Legacy outcome: no explanation was recorded.</p>
              ) : null}
            </section>
          ) : null}
        </aside>
      </div>
    </main>
  );
  function formatChange(value: unknown, key: string) {
    if (value === null || value === undefined) return 'None';
    if (key === 'assignedAgentProfileId')
      return (
        reads.data?.agents.find((agent) => agent.id === value)?.displayName ?? 'Previous operator'
      );
    return label(String(value));
  }
}
