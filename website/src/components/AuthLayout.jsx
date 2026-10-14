import { ArrowLeft, ArrowRight, Check, ShieldCheck, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function AuthLayout({ eyebrow, title, description, children, footer, mode = 'customer' }) {
  return (
    <main className="auth-screen">
      <section className="auth-story" aria-label="Nearby introduction">
        <Link to="/" className="brand brand-dark"><span className="brand-mark"><img className="brand-logo" src="/logo.png" alt="" /></span><span>nearby</span></Link>
        <div className="auth-story-content">
          <span className="eyebrow"><Sparkles size={15} /> {mode === 'provider' ? 'Your work, closer to home' : 'A little help goes a long way'}</span>
          <h1>Good work.<br /><em>Closer by.</em></h1>
          <p>Find trusted local people for the things that make a house feel like home.</p>
          <div className="auth-trust-row">
            <span className="trust-icon"><ShieldCheck size={18} /></span>
            <span><strong>Thoughtful local connections</strong><small>Clear profiles, real bookings, helpful support.</small></span>
          </div>
        </div>
        <div className="auth-story-bottom"><span>Made for everyday life in India</span><span>01 — 03</span></div>
        <div className="auth-sunburst" aria-hidden="true">✳</div>
      </section>
      <section className="auth-panel">
        <Link to="/" className="auth-back"><ArrowLeft size={16} /> Back to Nearby</Link>
        <div className="auth-form-wrap">
          <span className="eyebrow text-muted">{eyebrow}</span>
          <h2>{title}</h2>
          <p className="auth-description">{description}</p>
          {children}
          {footer && <div className="auth-footer">{footer}</div>}
          <p className="auth-privacy"><Check size={14} /> Your details stay private and secure.</p>
        </div>
        <span className="auth-corner-note">NEARBY · INDIA</span>
      </section>
    </main>
  )
}

export function AuthSubmit({ children, loading }) {
  return <button type="submit" className="button button-primary auth-submit" disabled={loading}>{loading ? <span className="spinner" /> : <>{children}<ArrowRight size={17} /></>}</button>
}
