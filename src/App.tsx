import { useEffect, useState, type FormEvent } from 'react';
import {
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router-dom';
import { api, errorText, session, sessionChanged } from './api';
import { useRefresh } from './hooks';
import { Queue } from './Queue';
import { RequestDetail } from './RequestDetail';
export function App() {
  const [token, setToken] = useState(session.get);
  useEffect(() => {
    const update = () => setToken(session.get());
    window.addEventListener(sessionChanged, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(sessionChanged, update);
      window.removeEventListener('storage', update);
    };
  }, []);
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={token ? <Access key={token} /> : <LoginRedirect />}>
        <Route path="/requests" element={<Queue />} />
        <Route path="/requests/:id" element={<RequestDetail />} />
      </Route>
      <Route path="*" element={<Navigate to="/requests" replace />} />
    </Routes>
  );
}
function LoginRedirect() {
  const location = useLocation();
  return (
    <Navigate
      to={`/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`}
      replace
    />
  );
}
function Access() {
  const profile = useRefresh('identity', api.me);
  if (!profile.data)
    return (
      <main className="access">
        <h1>{profile.error ? 'Support access unavailable' : 'Checking support access…'}</h1>
        {profile.error ? (
          <>
            <p role="alert">{profile.error}</p>
            <button onClick={() => void profile.refresh().catch(() => undefined)}>Try again</button>
            <button onClick={session.clear}>Switch account</button>
          </>
        ) : null}
      </main>
    );
  return (
    <div className="shell">
      <header className="masthead">
        <Link to="/requests" className="brand">
          AUTOFLEX <span>Support desk</span>
        </Link>
        <div>
          {profile.data.displayName}
          <span className="role">
            {profile.data.roles.includes('support_manager') ? 'Manager' : 'Agent'}
          </span>
          <button onClick={session.clear}>Sign out</button>
        </div>
      </header>
      {profile.error ? <p className="error">Session check failed: {profile.error}</p> : null}
      <Outlet context={profile.data} />
    </div>
  );
}
function Login() {
  const [phone, setPhone] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const local = import.meta.env.VITE_SUPPORT_LOCAL_AUTH === 'true';
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const token = await api.login(phone);
      session.set(token);
      const path = params.get('returnTo') ?? '/requests';
      navigate(/^\/requests(?:\/[-a-f0-9]{36})?(?:\?[^#]*)?$/.test(path) ? path : '/requests', {
        replace: true,
      });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login">
      <section>
        <p className="eyebrow">AUTOFLEX · SUPPORT</p>
        <h1>
          A clear next step.
          <br />
          For every request.
        </h1>
        <p>
          Work the central queue, keep a complete history, and reply where customers can find it.
        </p>
      </section>
      <form onSubmit={submit}>
        <h2>Support sign in</h2>
        {local ? (
          <>
            <p>Local development accounts</p>
            <label>
              Support mobile
              <input
                required
                inputMode="tel"
                autoComplete="tel"
                pattern="[6-9][0-9]{9}"
                maxLength={10}
                value={phone}
                onChange={(event) => setPhone(event.target.value.replace(/\D/g, '').slice(0, 10))}
              />
            </label>
            <button className="primary" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <small>
              Neha · 9845000011
              <br />
              Kabir · 9845000012
              <br />
              Ananya (manager) · 9845000013
            </small>
          </>
        ) : (
          <p>
            Support sign-in requires the configured IAM application. Contact your administrator to
            enable it.
          </p>
        )}
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </main>
  );
}
