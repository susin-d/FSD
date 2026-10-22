import { useState } from 'react'
import { Link } from 'react-router-dom'
import AuthLayout, { AuthSubmit } from '../../components/AuthLayout.jsx'
import { api, errorMessage } from '../../services/api.js'

export default function PasswordRecovery() {
  const [stage, setStage] = useState('request')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function requestCode(event) {
    event?.preventDefault()
    setError('')
    setLoading(true)
    try {
      const result = await api.post('/auth/password-reset/request', { email })
      setMessage(result?.message || 'If an account exists for this email, a reset code will be sent.')
      setCode('')
      setStage('confirm')
    } catch (requestError) {
      setError(errorMessage(requestError, 'We could not request a reset code. Try again.'))
    } finally {
      setLoading(false)
    }
  }

  async function confirmReset(event) {
    event.preventDefault()
    setError('')
    if (password !== confirmation) {
      setError('The passwords do not match.')
      return
    }
    setLoading(true)
    try {
      await api.post('/auth/password-reset/confirm', { email, code, password })
      setPassword('')
      setConfirmation('')
      setCode('')
      setStage('complete')
    } catch (requestError) {
      setError(errorMessage(requestError, 'We could not reset your password. Check the code and try again.'))
    } finally {
      setLoading(false)
    }
  }

  const title = stage === 'request' ? 'Reset your password' : stage === 'confirm' ? 'Choose a new password' : 'Password updated'
  const description = stage === 'request'
    ? 'We will email a one-time code if an account matches your email address.'
    : stage === 'confirm'
      ? 'Enter the six-digit code and choose a new password.'
      : 'Your password has been changed. Sign in with your new password.'

  return <AuthLayout
    eyebrow="Account recovery"
    title={title}
    description={description}
    footer={<>Remembered your password? <Link to="/login">Sign in</Link></>}
  >
    {stage === 'complete' ? <div className="recovery-complete" role="status">
      <p>Your password has been updated successfully.</p>
      <Link className="button button-primary" to="/login">Return to sign in</Link>
    </div> : stage === 'request' ? <form className="auth-form" onSubmit={requestCode}>
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      <label className="field"><span>Email address</span><input type="email" autoComplete="email" required placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <AuthSubmit loading={loading}>Send reset code</AuthSubmit>
    </form> : <form className="auth-form" onSubmit={confirmReset}>
      {message && <div className="notice notice-warning recovery-code-note" role="status">{message}</div>}
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      <label className="field"><span>Email address</span><input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label className="field"><span>Six-digit code</span><input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required placeholder="000000" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
      <label className="field"><span>New password</span><input type="password" autoComplete="new-password" minLength={8} maxLength={72} required placeholder="At least 8 characters" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <label className="field"><span>Confirm new password</span><input type="password" autoComplete="new-password" minLength={8} maxLength={72} required placeholder="Enter the password again" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
      <AuthSubmit loading={loading}>Update password</AuthSubmit>
      <div className="recovery-actions"><button className="password-recovery-link" type="button" disabled={loading} onClick={() => { setStage('request'); setMessage(''); setError(''); setCode(''); setPassword(''); setConfirmation('') }}>Change email</button><button className="password-recovery-link" type="button" disabled={loading} onClick={requestCode}>Send a new code</button></div>
    </form>}
  </AuthLayout>
}
