import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AuthLayout, { AuthSubmit } from '../../components/AuthLayout.jsx'
import { useSession } from '../../services/useSession.js'
import { errorMessage } from '../../services/api.js'

export default function Signup() {
  const { register } = useSession()
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'customer' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      await register(form)
      navigate(form.role === 'provider' ? '/provider' : '/dashboard', { replace: true })
    } catch (requestError) {
      setError(errorMessage(requestError, 'We could not create your account. Please try again.'))
    } finally {
      setLoading(false)
    }
  }

  return <AuthLayout eyebrow="Start nearby" title="Create your account" description="One account for finding great local help or sharing your own skills." mode={form.role} footer={<>Already have an account? <Link to="/login">Sign in</Link></>}>
    <form onSubmit={submit} className="auth-form">
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      <label className="field"><span>Your name</span><input type="text" autoComplete="name" required maxLength="80" placeholder="What should we call you?" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
      <label className="field"><span>Email address</span><input type="email" autoComplete="email" required placeholder="you@example.com" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
      <label className="field"><span>Password</span><input type="password" autoComplete="new-password" minLength="8" required placeholder="At least 8 characters" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
      <fieldset className="role-picker"><legend>I’m here to…</legend>
        <label className={form.role === 'customer' ? 'role-choice selected' : 'role-choice'}><input type="radio" name="role" value="customer" checked={form.role === 'customer'} onChange={() => setForm({ ...form, role: 'customer' })} /><span><strong>Book a service</strong><small>Find help around the home</small></span></label>
        <label className={form.role === 'provider' ? 'role-choice selected' : 'role-choice'}><input type="radio" name="role" value="provider" checked={form.role === 'provider'} onChange={() => setForm({ ...form, role: 'provider' })} /><span><strong>Offer my services</strong><small>Meet customers nearby</small></span></label>
      </fieldset>
      <AuthSubmit loading={loading}>Create account</AuthSubmit>
      <p className="fine-print">Provider services become visible after verification. We’ll show your verification status in your account.</p>
    </form>
  </AuthLayout>
}
