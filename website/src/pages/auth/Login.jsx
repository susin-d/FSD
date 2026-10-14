import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import AuthLayout, { AuthSubmit } from '../../components/AuthLayout.jsx'
import { useSession } from '../../services/useSession.js'
import { errorMessage } from '../../services/api.js'

export default function Login() {
  const { login } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(form)
      navigate(location.state?.from || '/dashboard', { replace: true })
    } catch (requestError) {
      setError(errorMessage(requestError, 'We could not sign you in. Check your details and try again.'))
    } finally {
      setLoading(false)
    }
  }

  return <AuthLayout eyebrow="Welcome back" title="Sign in to Nearby" description="Pick up where you left off." footer={<>New to Nearby? <Link to="/signup">Create an account</Link></>}>
    <form onSubmit={submit} className="auth-form">
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      <label className="field"><span>Email address</span><input type="email" autoComplete="email" required placeholder="you@example.com" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
      <label className="field"><span>Password</span><input type="password" autoComplete="current-password" required placeholder="Enter your password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
      <div className="form-inline-end"><span>Use the email linked to your account</span></div>
      <AuthSubmit loading={loading}>Sign in</AuthSubmit>
    </form>
  </AuthLayout>
}
