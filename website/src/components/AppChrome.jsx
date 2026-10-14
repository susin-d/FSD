import { useState } from 'react'
import { ArrowRight, ChevronDown, LayoutDashboard, LogIn, LogOut, Menu, X } from 'lucide-react'
import { Link, NavLink } from 'react-router-dom'
import { useSession } from '../services/useSession.js'
import { destinationFor } from '../services/roles.js'

export function SiteHeader({ compact = false }) {
  const { user, logout } = useSession()
  const [menuOpen, setMenuOpen] = useState(false)
  return <header className="site-header">
    <div className="header-inner">
      <Link to="/" className="brand" aria-label="Nearby home"><span className="brand-mark"><img className="brand-logo" src="/logo.png" alt="" /></span><span>nearby</span></Link>
      <nav className={menuOpen ? 'header-nav open' : 'header-nav'} aria-label="Main navigation">
        <NavLink to="/services" onClick={() => setMenuOpen(false)}>Explore services</NavLink>
        {!compact && <a href="/signup" onClick={() => setMenuOpen(false)}>Become a pro</a>}
      </nav>
      <div className="header-actions">
        {user ? <>
          <Link className="button button-small button-outline header-dashboard" to={destinationFor(user)}><LayoutDashboard size={16} /> My Nearby <ArrowRight size={15} /></Link>
          <button className="icon-button signout-button" title="Sign out" onClick={logout}><LogOut size={17} /></button>
        </> : <>
          <Link className="header-login" to="/login"><LogIn size={15} /> Sign in</Link>
          <Link className="button button-small button-dark" to="/signup">Join Nearby <ArrowRight size={15} /></Link>
        </>}
        <button className="icon-button menu-toggle" aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={20} /> : <Menu size={20} />}</button>
      </div>
    </div>
  </header>
}

export function DashboardHeader() {
  const { user, logout } = useSession()
  const name = user?.name || user?.fullName || user?.email?.split('@')[0] || 'Neighbor'
  const firstName = name.split(' ')[0]
  return <header className="dash-topbar">
    <Link to="/" className="brand"><span className="brand-mark"><img className="brand-logo" src="/logo.png" alt="" /></span><span>nearby</span></Link>
    <div className="dash-topbar-right"><span className="welcome-note">Hello, {firstName}</span><span className="avatar">{firstName.slice(0, 1).toUpperCase()}</span><button className="icon-button" title="Sign out" onClick={logout}><LogOut size={17} /></button></div>
  </header>
}

export function PageTitle({ eyebrow, title, description, action }) {
  return <div className="page-title-row"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{description && <p>{description}</p>}</div>{action && <div className="page-title-action">{action}</div>}</div>
}

export function LoadingState({ label = 'Loading nearby…', full = false }) {
  return <div className={full ? 'loading-state full' : 'loading-state'}><span className="spinner" /><span>{label}</span></div>
}

export function ErrorState({ message, onRetry }) {
  return <div className="state-card state-error"><span className="state-mark">!</span><div><strong>We hit a small snag</strong><p>{message}</p>{onRetry && <button className="button button-small button-outline" onClick={onRetry}>Try again</button>}</div></div>
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return <div className="empty-state"><span className="empty-icon">{Icon ? <Icon size={23} /> : <ChevronDown size={22} />}</span><h3>{title}</h3><p>{description}</p>{action}</div>
}

export function Badge({ children, tone = 'neutral' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

export function ServiceCard({ service }) {
  const id = service?._id || service?.id || service?.serviceId
  const title = service?.title || service?.name || service?.serviceName || 'Local service'
  const provider = service?.provider?.user?.name || service?.provider?.name || service?.providerName || service?.provider?.fullName || service?.provider?.businessName || ''
  const category = service?.category || 'Service'
  const price = service?.price ?? service?.basePrice
  return <Link className="service-card" to={id ? `/services/${id}` : '/services'}>
    <div className="service-card-art"><span className="category-label">{category}</span><span className="service-art-orbit" aria-hidden="true">✳</span><span className="service-art-initial">{title.trim().slice(0, 1).toUpperCase()}</span></div>
    <div className="service-card-body"><div className="service-card-title"><h3>{title}</h3><span className="card-arrow"><ArrowRight size={15} /></span></div>{provider && <p className="service-provider">by {provider}</p>}<div className="service-card-meta"><strong>{price == null ? 'Ask for price' : `₹${Number(price).toLocaleString('en-IN')}`}{service?.priceUnit ? <small> / {service.priceUnit}</small> : null}</strong><span>{service?.rating ? `★ ${Number(service.rating).toFixed(1)}` : 'View details'}</span></div></div>
  </Link>
}

export function Footer() {
  return <footer className="site-footer"><Link to="/" className="brand"><span className="brand-mark"><img className="brand-logo" src="/logo.png" alt="" /></span><span>nearby</span></Link><span>Local hands. Good help. Right around here.</span><span>© Nearby · India</span></footer>
}
