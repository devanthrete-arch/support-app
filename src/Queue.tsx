import { useEffect, useRef, useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { api, errorText } from './api';
import { useRefresh } from './hooks';
import type { Me, QueueItem } from './types';
import { label, when, Badge } from './ui';
const tabs = [
  ['active', 'All active', 'active'],
  ['unassigned', 'Unassigned', 'unassigned'],
  ['mine', 'Mine', 'mine'],
  ['reply', 'Needs reply', 'needsReply'],
  ['inactive', 'Inactive owner', 'inactiveAssignee'],
  ['resolved', 'Resolved', 'resolved'],
  ['closed', 'Closed', 'closed'],
] as const;
export function Queue() {
  const me = useOutletContext<Me>(),
    [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'active';
  const query = new URLSearchParams(params);
  query.delete('tab');
  query.set('limit', '30');
  query.set('status', tab === 'resolved' ? 'RESOLVED' : tab === 'closed' ? 'CLOSED' : 'ACTIVE');
  if (tab === 'mine') query.set('assignee', 'me');
  if (tab === 'unassigned') query.set('assignee', 'unassigned');
  if (tab === 'inactive') query.set('assignee', 'inactive');
  if (tab === 'reply') query.set('needsReply', 'true');
  const key = query.toString();
  const reads = useRefresh(key, async () => {
    const [page, summary, agents] = await Promise.all([
      api.queue(key),
      api.summary(key),
      api.agents(me.roles.includes('support_manager') && me.permissions.includes('support:manage')),
    ]);
    return { page, summary, agents };
  });
  const [extra, setExtra] = useState<{
    identity: string;
    items: QueueItem[];
    cursor: string | null;
  }>({ identity: key, items: [], cursor: null });
  const [moreBusy, setMoreBusy] = useState(false),
    [moreError, setMoreError] = useState('');
  const identity = useRef(key);
  identity.current = key;
  const list = extra.identity === key ? extra.items : [];
  // A fresh first page invalidates continuation pages whose sort position may have changed.
  useEffect(() => {
    setExtra({ identity: key, items: [], cursor: reads.data?.page.nextCursor ?? null });
    setMoreError('');
  }, [key, reads.data]);
  function filter(name: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    setParams(next);
  }
  async function more() {
    if (!extra.cursor || moreBusy) return;
    const current = key;
    setMoreBusy(true);
    setMoreError('');
    try {
      const next = new URLSearchParams(key);
      next.set('cursor', extra.cursor);
      const page = await api.queue(next.toString());
      if (identity.current === current)
        setExtra((old) => ({
          identity: current,
          items: [...old.items, ...page.items],
          cursor: page.nextCursor,
        }));
    } catch (err) {
      if (identity.current === current) setMoreError(errorText(err));
    } finally {
      setMoreBusy(false);
    }
  }
  const all = [...(reads.data?.page.items ?? []), ...list].filter(
    (item, index, array) => array.findIndex((row) => row.id === item.id) === index,
  );
  return (
    <main>
      <div className="page-heading">
        <div>
          <p className="eyebrow">CENTRAL AUTOFLEX QUEUE</p>
          <h1>Support requests</h1>
          <p>Oldest first within each priority. Every request has an owner and a next step.</p>
        </div>
        <div className="refresh">
          <button disabled={reads.busy} onClick={() => void reads.refresh().catch(() => undefined)}>
            {reads.busy ? 'Refreshing…' : 'Refresh'}
          </button>
          <small>
            {reads.updated ? `Updated ${when(reads.updated.toISOString())}` : 'Loading queue'}
          </small>
        </div>
      </div>
      <nav className="tabs" aria-label="Queue views">
        {tabs
          .filter(([id]) => id !== 'inactive' || me.roles.includes('support_manager'))
          .map(([id, title, count]) => (
            <button
              key={id}
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => {
                const next = new URLSearchParams(params);
                next.set('tab', id);
                next.delete('assignee');
                setParams(next);
              }}
            >
              {title}
              <span>{reads.data?.summary[count] ?? '–'}</span>
            </button>
          ))}
      </nav>
      <form className="filters" onSubmit={(event) => event.preventDefault()}>
        <label className="search">
          Search
          <input
            aria-label="Search requests"
            placeholder="Reference, subject, customer, booking or job"
            value={params.get('q') ?? ''}
            onChange={(event) => filter('q', event.target.value)}
            maxLength={150}
          />
        </label>
        <label>
          Category
          <select
            value={params.get('category') ?? ''}
            onChange={(event) => filter('category', event.target.value)}
          >
            <option value="">All categories</option>
            {['BOOKING', 'SERVICE', 'PAYMENT', 'ACCOUNT', 'APP', 'OTHER'].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Priority
          <select
            value={params.get('priority') ?? ''}
            onChange={(event) => filter('priority', event.target.value)}
          >
            <option value="">All priorities</option>
            <option>NORMAL</option>
            <option>HIGH</option>
          </select>
        </label>
        <label>
          Waiting on
          <select
            value={params.get('waitingOn') ?? ''}
            onChange={(event) => filter('waitingOn', event.target.value)}
          >
            <option value="">Any</option>
            {['CUSTOMER', 'CENTER', 'INTERNAL', 'NONE'].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Owner
          <select
            value={params.get('assignee') ?? 'all'}
            disabled={['mine', 'unassigned', 'inactive'].includes(tab)}
            onChange={(event) => filter('assignee', event.target.value)}
          >
            <option value="all">All operators</option>
            <option value="me">Assigned to me</option>
            <option value="unassigned">Unassigned</option>
            {reads.data?.agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.displayName}
                {agent.isActive ? '' : ' (inactive)'}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sort
          <select
            value={params.get('sort') ?? 'oldest'}
            onChange={(event) => filter('sort', event.target.value)}
          >
            <option value="oldest">Oldest first</option>
            <option value="recentActivity">Recent activity</option>
          </select>
        </label>
      </form>
      {reads.error ? (
        <p className="error" role="alert">
          {reads.error}{' '}
          <button onClick={() => void reads.refresh().catch(() => undefined)}>Retry</button>
        </p>
      ) : null}
      {!reads.data && reads.busy ? <p role="status">Loading requests…</p> : null}
      {reads.data && all.length === 0 ? (
        <section className="empty">
          <h2>No requests in this view</h2>
          <p>Change your filters or check again later.</p>
        </section>
      ) : null}
      {all.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Request</th>
                <th>Customer</th>
                <th>Status / next step</th>
                <th>Owner</th>
                <th>Age / activity</th>
              </tr>
            </thead>
            <tbody>
              {all.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Link
                      className="request-link"
                      to={`/requests/${row.id}?returnTo=${encodeURIComponent('/requests?' + params.toString())}`}
                    >
                      <small>
                        {row.referenceNumber} · {label(row.category)}
                      </small>
                      <strong>{row.subject}</strong>
                    </Link>
                    {row.priority === 'HIGH' ? <Badge tone="high">High priority</Badge> : null}
                  </td>
                  <td>
                    {row.customer?.displayName ?? 'Customer'}
                    <small>{row.customer?.phone ?? 'No phone'}</small>
                  </td>
                  <td>
                    <Badge>{label(row.status)}</Badge>
                    {row.needsReply ? (
                      <small className="attention">Needs support reply</small>
                    ) : null}
                    {row.waitingOn ? (
                      <small>Waiting on {label(row.waitingOn).toLowerCase()}</small>
                    ) : null}
                  </td>
                  <td>
                    {row.assignee?.displayName ?? 'Unassigned'}
                    {row.assignee && !row.assignee.isActive ? (
                      <small className="attention">Inactive · manager reassignment needed</small>
                    ) : null}
                  </td>
                  <td>
                    <span>{age(row.createdAt)} old</span>
                    <small>Active {when(row.lastActivityAt)}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {moreError ? (
        <p className="error" role="alert">
          {moreError}
        </p>
      ) : null}
      {extra.cursor ? (
        <button className="load-more" disabled={moreBusy} onClick={() => void more()}>
          {moreBusy ? 'Loading…' : 'Load more requests'}
        </button>
      ) : null}
    </main>
  );
}
function age(date: string) {
  const hours = Math.max(0, Math.floor((Date.now() - Date.parse(date)) / 3600000));
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}
