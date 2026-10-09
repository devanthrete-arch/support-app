import { createRoot } from 'react-dom/client';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { act } from 'react';
import { api, ApiError } from '../src/api';
import { RequestDetail } from '../src/RequestDetail';
import type { CommandBody, Detail, Me, Receipt, SupportEvent } from '../src/types';
import '../src/styles.css';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
const me: Me = {
  id: 'd0000000-0000-4000-8000-000000000001',
  displayName: 'Test agent',
  isActive: true,
  roles: ['support_agent'],
  permissions: ['support:read', 'support:work'],
};
const row: Detail = {
  id: 'e0000000-0000-4000-8000-000000000001',
  referenceNumber: 'SR-TEST-0001',
  category: 'ACCOUNT',
  subject: 'Command regression request',
  message: 'Please help with this account.',
  status: 'IN_PROGRESS',
  priority: 'NORMAL',
  waitingOn: null,
  version: 1,
  needsReply: true,
  customer: {
    displayName: 'Test customer',
    phone: null,
    email: null,
    preferredChannel: 'WHATSAPP',
    whatsappConsent: false,
    emailConsent: false,
  },
  assignee: me,
  createdAt: '2026-10-09T00:00:00Z',
  lastActivityAt: '2026-10-09T00:00:00Z',
  firstResponseAt: null,
  lastCustomerMessageAt: '2026-10-09T00:00:00Z',
  lastPublicReplyAt: null,
  preferredChannel: null,
  resolutionCode: null,
  resolutionSummary: null,
  closureSummary: null,
  resolvedAt: null,
  closedAt: null,
  legacyResolutionUnknown: false,
  linkedContext: { state: 'NONE', booking: null, job: null },
};
const history: SupportEvent[] = [];
const receipts = new Map<string, Receipt>();
const calls: { body: CommandBody; key: string; version: number }[] = [];
let mode: 'normal' | 'uncertain' | 'conflict' | 'readFailure' = 'normal',
  readFailure = false;
api.detail = async () => {
  if (readFailure) {
    readFailure = false;
    throw new ApiError(0, 'Injected refresh failure');
  }
  return structuredClone(row);
};
api.history = async () => ({ items: structuredClone(history), nextBeforeVersion: null });
api.agents = async () => [me];
api.command = async (id, command, body, version, key) => {
  calls.push({ body: structuredClone(body), key, version });
  if (receipts.has(key)) return receipts.get(key)!;
  if (mode === 'conflict') {
    mode = 'normal';
    row.version++;
    throw new ApiError(
      409,
      'Another operator changed this request',
      'SUPPORT_VERSION_CONFLICT',
      row.version,
    );
  }
  if (version !== row.version) throw new ApiError(409, 'Stale request');
  row.version++;
  const receipt: Receipt = {
    requestId: id,
    version: row.version,
    status: row.status,
    eventId: crypto.randomUUID(),
  };
  receipts.set(key, receipt);
  history.push({
    id: receipt.eventId,
    version: row.version,
    type: command === 'notes' ? 'INTERNAL_NOTE' : 'PUBLIC_REPLY',
    visibility: command === 'notes' ? 'INTERNAL' : 'PUBLIC',
    body: String(body.message),
    author: me.displayName,
    changes: null,
    createdAt: new Date().toISOString(),
  });
  if (mode === 'uncertain') {
    mode = 'normal';
    throw new ApiError(0, 'Response lost');
  }
  if (mode === 'readFailure') {
    mode = 'normal';
    readFailure = true;
  }
  return receipt;
};
const root = createRoot(document.getElementById('root')!);
const results = document.getElementById('results')!;
results.style.cssText = 'padding:25px;background:#172a38;color:white;';
results.innerHTML = '<h1>AF-010 · Command regressions</h1>';
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
function field(name: string) {
  const found = [...document.querySelectorAll('label')]
    .find((label) => label.textContent?.trim().startsWith(name))
    ?.querySelector('textarea');
  if (!found) throw new Error(`Missing field ${name}`);
  return found;
}
async function fill(name: string, value: string) {
  await act(async () => {
    const input = field(name);
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function click(name: string) {
  await act(async () => {
    const button = [...document.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === name,
    );
    if (!button || button.disabled) throw new Error(`Unavailable button ${name}`);
    button.click();
  });
  await flush();
}
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
async function test(name: string, run: () => Promise<void>) {
  try {
    await run();
    results.insertAdjacentHTML('beforeend', `<p>PASS · ${name}</p>`);
  } catch (error) {
    results.insertAdjacentHTML(
      'beforeend',
      `<p>FAIL · ${name}: ${error instanceof Error ? error.message : String(error)}</p>`,
    );
    throw error;
  }
}
async function main() {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/requests/' + row.id]}>
        <Routes>
          <Route element={<Outlet context={me} />}>
            <Route path="/requests/:id" element={<RequestDetail />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
  });
  await flush();
  await test('Independent public and private drafts', async () => {
    await fill('Public reply', 'Public draft retained');
    await fill('Internal note', 'Private note only');
    await click('Save private note');
    assert(field('Public reply').value === 'Public draft retained', 'Public draft changed');
    assert(field('Internal note').value === '', 'Private draft not cleared');
    assert(history[0].visibility === 'INTERNAL', 'Note became public');
  });
  await test('Uncertain response retries exact key, version and body once', async () => {
    mode = 'uncertain';
    await click('Send public reply');
    assert(field('Public reply').value === 'Public draft retained', 'Draft lost');
    assert(
      [...document.querySelectorAll('button')].find((b) => b.textContent === 'Save private note')
        ?.disabled,
      'Other writes enabled',
    );
    await click('Retry same command');
    assert(
      JSON.stringify(calls[calls.length - 1]) === JSON.stringify(calls[calls.length - 2]),
      'Retry changed command',
    );
    assert(
      history.filter((e) => e.type === 'PUBLIC_REPLY').length === 1,
      'Duplicate public message',
    );
    assert(field('Public reply').value === '', 'Successful retry did not clear draft');
  });
  await test('Conflict keeps draft and requires refresh before a new attempt', async () => {
    await fill('Internal note', 'Draft after stale version');
    mode = 'conflict';
    await click('Save private note');
    assert(field('Internal note').value === 'Draft after stale version', 'Conflict lost draft');
    const failed = calls[calls.length - 1];
    await click('Refresh and review');
    assert(field('Internal note').value === 'Draft after stale version', 'Refresh lost draft');
    await click('Save private note');
    const retried = calls[calls.length - 1];
    assert(
      failed.key !== retried.key && retried.version === failed.version + 1,
      'Conflict reused stale key/version',
    );
  });
  await test('Committed save remains successful when subsequent refresh fails', async () => {
    await fill('Public reply', 'A saved reply despite refresh failure');
    mode = 'readFailure';
    await click('Send public reply');
    assert(
      document.body.textContent?.includes('Saved successfully; could not refresh'),
      'Missing separate refresh error',
    );
    assert(
      !document.body.textContent?.includes('Retry same command'),
      'Successful save shown as uncertain',
    );
    const count = history.length;
    await click('Retry refresh');
    assert(history.length === count, 'Refresh duplicated command');
  });
  results.insertAdjacentHTML('beforeend', '<strong>4/4 scenarios passed</strong>');
}
void main().catch((error) => console.error(error));
