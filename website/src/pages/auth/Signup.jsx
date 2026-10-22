import { useState } from 'react'
import { BriefcaseBusiness, Eye, EyeOff, UserRound } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import AuthLayout, { AuthSubmit } from '../../components/AuthLayout.jsx'
import { useSession } from '../../services/useSession.js'
import { errorMessage } from '../../services/api.js'

const countryCodes = ['+1', '+7', '+20', '+27', '+30', '+31', '+32', '+33', '+34', '+36', '+39', '+40', '+41', '+43', '+44', '+45', '+46', '+47', '+48', '+49', '+51', '+52', '+53', '+54', '+55', '+56', '+57', '+58', '+60', '+61', '+62', '+63', '+64', '+65', '+66', '+81', '+82', '+84', '+86', '+90', '+91', '+92', '+93', '+94', '+95', '+98', '+211', '+212', '+213', '+216', '+218', '+220', '+221', '+222', '+223', '+224', '+225', '+226', '+227', '+228', '+229', '+230', '+231', '+232', '+233', '+234', '+235', '+236', '+237', '+238', '+239', '+240', '+241', '+242', '+243', '+244', '+245', '+246', '+248', '+249', '+250', '+251', '+252', '+253', '+254', '+255', '+256', '+257', '+258', '+260', '+261', '+262', '+263', '+264', '+265', '+266', '+267', '+268', '+269', '+290', '+291', '+297', '+298', '+299', '+350', '+351', '+352', '+353', '+354', '+355', '+356', '+357', '+358', '+359', '+370', '+371', '+372', '+373', '+374', '+375', '+376', '+377', '+378', '+380', '+381', '+382', '+383', '+385', '+386', '+387', '+389', '+420', '+421', '+423', '+500', '+501', '+502', '+503', '+504', '+505', '+506', '+507', '+508', '+509', '+590', '+591', '+592', '+593', '+594', '+595', '+596', '+597', '+598', '+599', '+670', '+672', '+673', '+674', '+675', '+676', '+677', '+678', '+679', '+680', '+681', '+682', '+683', '+685', '+686', '+687', '+688', '+689', '+690', '+691', '+692', '+850', '+852', '+853', '+855', '+856', '+880', '+886', '+960', '+961', '+962', '+963', '+964', '+965', '+966', '+967', '+968', '+970', '+971', '+972', '+973', '+974', '+975', '+976', '+977', '+992', '+993', '+994', '+995', '+996', '+998']

export default function Signup() {
  const { register } = useSession()
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', email: '', countryCode: '+91', phone: '', password: '', role: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  function chooseRole(role) {
    setForm((current) => ({ ...current, role }))
    setError('')
  }

  async function submit(event) {
    event.preventDefault()
    if (!form.role) return
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

  return <AuthLayout eyebrow="Start nearby" title="Create your account" description="Choose how you’ll use Nearby, then enter your details." mode={form.role || 'customer'} footer={<>Already have an account? <Link to="/login">Sign in</Link></>}>
    <form onSubmit={submit} className="auth-form">
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      <fieldset className="role-picker"><legend>Choose an account type</legend>
        <label className={form.role === 'customer' ? 'role-choice role-choice-user selected' : 'role-choice role-choice-user'}>
          <input type="radio" name="role" value="customer" checked={form.role === 'customer'} onChange={() => chooseRole('customer')} />
          <span className="role-choice-icon"><UserRound size={19} aria-hidden="true" /></span>
          <span className="role-choice-indicator" aria-hidden="true" />
          <span className="role-choice-copy"><strong>User</strong><small>Find and book local services</small></span>
        </label>
        <label className={form.role === 'provider' ? 'role-choice role-choice-provider selected' : 'role-choice role-choice-provider'}>
          <input type="radio" name="role" value="provider" checked={form.role === 'provider'} onChange={() => chooseRole('provider')} />
          <span className="role-choice-icon"><BriefcaseBusiness size={19} aria-hidden="true" /></span>
          <span className="role-choice-indicator" aria-hidden="true" />
          <span className="role-choice-copy"><strong>Service provider</strong><small>List services for nearby customers</small></span>
        </label>
      </fieldset>
      {!form.role && <p className="signup-role-hint">Select a card to continue to your details.</p>}
      {form.role && <section className="signup-details" aria-labelledby="signup-details-title">
        <h3 className="signup-details-title" id="signup-details-title">Your details</h3>
        <label className="field"><span>Your name</span><input type="text" autoComplete="name" required maxLength="80" placeholder="What should we call you?" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label className="field"><span>Email address</span><input type="email" autoComplete="email" required placeholder="you@example.com" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
        <label className="field"><span>Phone number</span><span className="phone-field"><select aria-label="Country code" value={form.countryCode} onChange={(event) => setForm({ ...form, countryCode: event.target.value })}>{countryCodes.map((code) => <option key={code} value={code}>{code}</option>)}</select><input type="tel" autoComplete="tel" required inputMode="numeric" maxLength="15" pattern="[0-9]{7,15}" placeholder="Phone number" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value.replace(/\D/g, '').slice(0, 15) })} /></span></label>
        <label className="field"><span>Password</span><span className="password-field"><input type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength="8" required placeholder="At least 8 characters" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /><button className="password-visibility" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}</button></span></label>
      </section>}
      {form.role && <AuthSubmit loading={loading}>Create account</AuthSubmit>}
      {form.role === 'provider' && <p className="fine-print">Provider services become visible after verification. We’ll show your verification status in your account.</p>}
    </form>
  </AuthLayout>
}
