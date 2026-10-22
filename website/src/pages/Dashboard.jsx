import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, ArrowRight, BadgeCheck, BriefcaseBusiness, CalendarDays, Check, CheckCircle2, CircleAlert, ClipboardList, Clock3, CreditCard, FileText, LayoutDashboard, LifeBuoy, LogOut, MapPin, MessageCircle, MessageSquare, Plus, Send, Settings2, ShieldCheck, Sparkles, Star, UserRound, Users, Wrench, X } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { io } from 'socket.io-client'
import { Badge, DashboardHeader, EmptyState, ErrorState, LoadingState, PageTitle } from '../components/AppChrome.jsx'
import { api, asList, errorMessage, formatMoney, getToken, idOf } from '../services/api.js'
import { useSession } from '../services/useSession.js'
import { getRole } from '../services/roles.js'

const NAV_ITEMS = {
  customer: [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'bookings', label: 'My bookings', icon: ClipboardList },
    { id: 'messages', label: 'Messages', icon: MessageSquare },
    { id: 'account', label: 'Account settings', icon: UserRound },
  ],
  provider: [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'bookings', label: 'Booking requests', icon: ClipboardList },
    { id: 'services', label: 'My services', icon: BriefcaseBusiness },
    { id: 'availability', label: 'Availability', icon: CalendarDays },
    { id: 'profile', label: 'My profile', icon: UserRound },
    { id: 'messages', label: 'Messages', icon: MessageSquare },
    { id: 'account', label: 'Account settings', icon: Settings2 },
  ],
  admin: [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'providers', label: 'Providers', icon: Users },
    { id: 'disputes', label: 'Disputes', icon: LifeBuoy },
    { id: 'audit', label: 'Activity log', icon: Activity },
    { id: 'account', label: 'Account settings', icon: UserRound },
    { id: 'settings', label: 'Marketplace settings', icon: Settings2 },
  ],
}

const ROLE_LABEL = { customer: 'Customer space', provider: 'Professional space', admin: 'Admin console' }

function safeList(value, ...keys) {
  if (Array.isArray(value)) return value
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key]
  return asList(value)
}

function bookingName(booking) {
  return booking?.service?.title || booking?.service?.name || booking?.serviceName || booking?.title || 'Service booking'
}

function bookingDate(booking) {
  const value = booking?.scheduledAt || booking?.date || booking?.bookingDate
  if (!value) return 'Time to be confirmed'
  const parsed = new Date(value)
  return Number.isNaN(parsed.valueOf()) ? String(value) : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(parsed)
}

function bookingStatus(booking) {
  return String(booking?.status || booking?.bookingStatus || 'requested').toLowerCase().replaceAll('_', ' ')
}

function statusTone(status) {
  if (['completed', 'paid', 'verified', 'resolved'].includes(status)) return 'success'
  if (['accepted', 'confirmed', 'in progress'].includes(status)) return 'blue'
  if (['cancelled', 'rejected', 'failed', 'expired'].includes(status)) return 'danger'
  if (['disputed', 'under review'].includes(status)) return 'warning'
  return 'neutral'
}

function localIndiaDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const get = (type) => parts.find((part) => part.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

function socketOrigin() {
  try { return new URL(import.meta.env.VITE_API_URL || 'http://localhost:4000/api/v1', window.location.origin).origin }
  catch { return window.location.origin }
}

async function loadCheckoutScript() {
  if (window.Razorpay) return true
  const existing = document.querySelector('script[data-razorpay-checkout]')
  if (existing) return new Promise((resolve) => {
    existing.addEventListener('load', () => resolve(Boolean(window.Razorpay)), { once: true })
    existing.addEventListener('error', () => resolve(false), { once: true })
  })
  return new Promise((resolve) => {
    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.async = true
    script.dataset.razorpayCheckout = 'true'
    script.onload = () => resolve(Boolean(window.Razorpay))
    script.onerror = () => resolve(false)
    document.body.appendChild(script)
  })
}

function StatsCard({ label, value, note, icon: Icon, tone = '' }) {
  return <article className={`stats-card ${tone}`}><span className="stats-icon"><Icon size={19} /></span><span className="stats-label">{label}</span><strong>{value ?? '—'}</strong>{note && <small>{note}</small>}</article>
}

function BookingCard({ booking, role, onAction, busyId, onReview, onDispute, onMessages }) {
  const id = idOf(booking)
  const status = bookingStatus(booking)
  const pending = ['pending', 'requested', 'awaiting provider'].includes(status)
  const accepted = ['accepted', 'awaiting payment', 'confirmed', 'completion pending', 'disputed'].includes(status)
  const checkoutAvailable = ['accepted', 'awaiting payment'].includes(status)
  const canComplete = ['confirmed'].includes(status)
  const completed = status === 'completed'
  const disputed = status === 'disputed' || Boolean(booking?.dispute?.status)
  const amount = booking?.pricePaise != null ? Number(booking.pricePaise) / 100 : booking?.amount ?? booking?.price ?? booking?.service?.price
  const customerName = booking?.customer?.name || booking?.customerName || ''
  const providerName = booking?.provider?.user?.name || booking?.provider?.businessName || booking?.provider?.name || booking?.providerName || ''
  const canReview = role === 'customer' && completed && !booking?.review && !booking?.reviewed
  const [reviewOpen, setReviewOpen] = useState(false)
  const [rating, setRating] = useState(5)
  const [comment, setComment] = useState('')
  const [disputeOpen, setDisputeOpen] = useState(false)
  const [reason, setReason] = useState('')

  return <article className="booking-card">
    <div className="booking-card-main"><span className="booking-service-mark"><Wrench size={20} /></span><div className="booking-info"><div className="booking-title-line"><h3>{bookingName(booking)}</h3><Badge tone={statusTone(status)}>{status}</Badge></div><p><CalendarDays size={14} /> {bookingDate(booking)}</p><p><MapPin size={14} /> {booking?.servicePincode || booking?.pincode || booking?.serviceAddress || 'Service location on file'}</p>{role === 'customer' && providerName && <p><UserRound size={14} /> {providerName}</p>}{role === 'provider' && customerName && <p><UserRound size={14} /> {customerName}</p>}</div><strong className="booking-amount">{formatMoney(amount)}</strong></div>
    {booking?.notes && <p className="booking-notes">“{booking.notes}”</p>}
    <div className="booking-card-actions">
      {role === 'provider' && pending && <><button className="button button-small button-primary" onClick={() => onAction(id, 'accept')} disabled={busyId === id}><Check size={15} /> Accept request</button><button className="button button-small button-outline" onClick={() => onAction(id, 'reject')} disabled={busyId === id}><X size={15} /> Decline</button></>}
      {checkoutAvailable && role === 'customer' && <button className="button button-small button-primary" onClick={() => onAction(id, 'checkout')} disabled={busyId === id}><CreditCard size={15} /> {busyId === id ? 'Opening checkout…' : 'Pay securely'}</button>}
      {accepted && <button className="button button-small button-outline" onClick={() => onMessages(id)}><MessageCircle size={15} /> Message</button>}
      {canComplete && !disputed && <button className="button button-small button-outline" onClick={() => onAction(id, 'complete')} disabled={busyId === id}><CheckCircle2 size={15} /> Mark complete</button>}
      {['requested', 'accepted', 'awaiting payment', 'confirmed'].includes(status) && <button className="button button-small button-quiet" onClick={() => onAction(id, 'cancel')} disabled={busyId === id}>Cancel</button>}
      {role !== 'admin' && ['confirmed', 'completion pending', 'completed'].includes(status) && !disputed && <button className="button button-small button-quiet" onClick={() => setDisputeOpen(!disputeOpen)}><LifeBuoy size={15} /> Raise a dispute</button>}
      {canReview && <button className="button button-small button-outline" onClick={() => setReviewOpen(!reviewOpen)}><Star size={15} /> Leave a review</button>}
      {disputed && <span className="muted-inline"><CircleAlert size={15} /> This booking is under review.</span>}
    </div>
    {reviewOpen && canReview && <form className="inline-form booking-inline-form" onSubmit={(event) => { event.preventDefault(); onReview(id, rating, comment) }}><label className="field"><span>Your rating</span><select value={rating} onChange={(event) => setRating(Number(event.target.value))}>{[5, 4, 3, 2, 1].map((number) => <option key={number} value={number}>{number} star{number > 1 ? 's' : ''}</option>)}</select></label><label className="field"><span>Share a few words</span><textarea rows="2" maxLength="500" required value={comment} onChange={(event) => setComment(event.target.value)} /></label><button className="button button-small button-primary" type="submit">Submit review <ArrowRight size={14} /></button></form>}
    {disputeOpen && <form className="inline-form booking-inline-form" onSubmit={(event) => { event.preventDefault(); onDispute(id, reason); setDisputeOpen(false) }}><label className="field"><span>What needs attention?</span><textarea rows="2" maxLength="500" minLength="8" required value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Describe the issue so the Nearby team can review it" /></label><button className="button button-small button-dark" type="submit">Send to review <ArrowRight size={14} /></button></form>}
  </article>
}

function BookingList({ bookings, role, onAction, busyId, onReview, onDispute, onMessages }) {
  if (!bookings.length) return <EmptyState icon={ClipboardList} title={role === 'provider' ? 'No booking requests yet' : 'Your bookings will show up here'} description={role === 'provider' ? 'When a customer sends a request, you can review and respond here.' : 'Once you request a nearby service, you can follow its progress here.'} action={role === 'customer' ? <Link to="/services" className="button button-small button-primary">Explore services <ArrowRight size={15} /></Link> : null} />
  const sorted = [...bookings].sort((a, b) => new Date(b.createdAt || b.scheduledAt || 0) - new Date(a.createdAt || a.scheduledAt || 0))
  return <div className="booking-list">{sorted.map((booking) => <BookingCard key={idOf(booking)} booking={booking} role={role} onAction={onAction} busyId={busyId} onReview={onReview} onDispute={onDispute} onMessages={onMessages} />)}</div>
}

function Overview({ role, user, bookings, stats, setView }) {
  const name = (user?.name || user?.fullName || user?.email?.split('@')[0] || 'neighbor').split(' ')[0]
  const pending = bookings.filter((item) => ['pending', 'requested', 'awaiting provider'].includes(bookingStatus(item))).length
  const inProgress = bookings.filter((item) => ['accepted', 'confirmed', 'awaiting payment', 'payment pending'].includes(bookingStatus(item))).length
  if (role === 'admin') {
    const metrics = stats?.stats || stats?.data || stats || {}
    return <><PageTitle eyebrow="YOUR MARKETPLACE AT A GLANCE" title="Good morning, Nearby." description="A clear view of the local marketplace and the work that needs your attention." />
      <div className="stats-grid"><StatsCard label="Total customers" value={metrics.totalCustomers ?? metrics.customers ?? '—'} icon={Users} note="Registered on Nearby" /><StatsCard label="Service professionals" value={metrics.totalProviders ?? metrics.providers ?? '—'} icon={BriefcaseBusiness} note="Provider accounts" tone="stat-blue" /><StatsCard label="Active bookings" value={metrics.activeBookings ?? metrics.bookings ?? '—'} icon={ClipboardList} note="Across the marketplace" tone="stat-yellow" /><StatsCard label="Open disputes" value={metrics.openDisputes ?? metrics.disputes ?? '—'} icon={LifeBuoy} note="Needs review" tone="stat-peach" /></div>
      <div className="overview-lower"><section className="dash-panel"><div className="panel-heading"><div><span className="eyebrow">MODERATION</span><h2>Keep Nearby in good hands</h2></div><ShieldCheck size={19} /></div><p>Review provider verification, resolve booking disputes, and keep marketplace rules up to date.</p><div className="panel-link-row"><button onClick={() => setView('providers')}>Review providers <ArrowRight size={15} /></button><button onClick={() => setView('disputes')}>Open disputes <ArrowRight size={15} /></button></div></section><section className="dash-panel dash-panel-yellow"><span className="eyebrow">OPERATIONS</span><h2>Set the ground rules.</h2><p>Manage commission, payment, cancellation, and timing values for the marketplace.</p><button className="text-link" onClick={() => setView('settings')}>Review marketplace settings <ArrowRight size={15} /></button></section></div>
    </>
  }
  return <><PageTitle eyebrow={role === 'provider' ? 'YOUR PROFESSIONAL SPACE' : 'YOUR NEARBY SPACE'} title={`Good to see you, ${name}.`} description={role === 'provider' ? 'Keep your services, schedule, and customer requests moving.' : 'Your local service plans, all in one place.'} action={role === 'customer' ? <Link to="/services" className="button button-small button-primary">Find a service <ArrowRight size={15} /></Link> : <button className="button button-small button-primary" onClick={() => setView('services')}>Add a service <Plus size={15} /></button>} />
    {role === 'provider' && <ProviderVerificationCard />}
    <div className="stats-grid"><StatsCard label={role === 'provider' ? 'New requests' : 'Open requests'} value={pending} icon={ClipboardList} note="Waiting for a response" /><StatsCard label="In progress" value={inProgress} icon={Clock3} note="Accepted bookings" tone="stat-blue" /><StatsCard label="Completed" value={bookings.filter((item) => bookingStatus(item) === 'completed').length} icon={CheckCircle2} note="Jobs marked complete" tone="stat-yellow" /><StatsCard label={role === 'provider' ? 'Services listed' : 'Your account'} value={role === 'provider' ? 'Manage' : 'Ready'} icon={role === 'provider' ? BriefcaseBusiness : Sparkles} note={role === 'provider' ? 'Publish after verification' : 'Find a helpful local pro'} tone="stat-peach" /></div>
    <div className="overview-lower"><section className="dash-panel"><div className="panel-heading"><div><span className="eyebrow">UP NEXT</span><h2>Recent bookings</h2></div><button className="text-link" onClick={() => setView('bookings')}>All bookings <ArrowRight size={15} /></button></div>{bookings.length ? <div className="mini-booking-list">{[...bookings].slice(0, 3).map((booking) => <div className="mini-booking" key={idOf(booking)}><span className="mini-booking-icon"><Wrench size={16} /></span><span><b>{bookingName(booking)}</b><small>{bookingDate(booking)}</small></span><Badge tone={statusTone(bookingStatus(booking))}>{bookingStatus(booking)}</Badge></div>)}</div> : <p className="panel-empty">No bookings yet. {role === 'customer' ? <Link to="/services">Find your first service</Link> : 'New requests will appear here.'}</p>}</section>
      <section className="dash-panel dash-panel-yellow"><span className="eyebrow">A LITTLE MORE LOCAL</span><div className="panel-doodle">✳</div><h2>{role === 'provider' ? 'Show up clearly.' : 'Need a hand?'} </h2><p>{role === 'provider' ? 'Keep your profile complete so customers know what you do and where you work.' : 'Browse skills from professionals who serve your exact PIN code.'}</p><button className="text-link" onClick={() => setView(role === 'provider' ? 'profile' : 'bookings')}>{role === 'provider' ? 'Update your profile' : 'Explore your bookings'} <ArrowRight size={15} /></button></section></div>
  </>
}

function ProviderVerificationCard() {
  const [profile, setProfile] = useState(null)
  useEffect(() => { api.get('/providers/me').then((data) => setProfile(data?.provider || data)).catch(() => setProfile(null)) }, [])
  const status = String(profile?.verificationStatus || profile?.status || (profile?.verified ? 'verified' : 'not started')).toLowerCase()
  const verified = profile?.verified === true || ['verified', 'approved'].includes(status)
  return <div className={verified ? 'verification-banner verified' : 'verification-banner'}><span className="verification-icon">{verified ? <BadgeCheck size={21} /> : <ShieldCheck size={21} />}</span><div><b>{verified ? 'Your provider profile is verified' : 'Provider verification is pending'}</b><p>{verified ? 'Eligible service listings can be published.' : 'You can complete your profile now. KYC checks will show as pending until the configured verification service is available.'}</p></div><Badge tone={verified ? 'success' : 'warning'}>{status}</Badge></div>
}

function ProviderWorkspace({ view }) {
  const [profile, setProfile] = useState(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [profileError, setProfileError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [verificationUrl, setVerificationUrl] = useState('')
  const [service, setService] = useState({ title: '', description: '', category: '', price: '', durationMinutes: '60', servicePincodes: '' })
  const [createdServices, setCreatedServices] = useState([])
  const [selectedDate, setSelectedDate] = useState(localIndiaDate())
  const [slots, setSlots] = useState([])
  const [slotForm, setSlotForm] = useState({ startTime: '09:00', endTime: '10:00' })
  const [slotLoading, setSlotLoading] = useState(view === 'availability')
  const [slotError, setSlotError] = useState('')

  useEffect(() => {
    let active = true
    Promise.all([api.get('/providers/me'), api.get('/services/mine').catch(() => null)])
      .then(([data, serviceData]) => {
        if (!active) return
        const next = data?.provider || data?.profile || data
        setProfile(next)
        setCreatedServices(safeList(serviceData, 'items'))
        if (!idOf(next) && !idOf(next?.provider)) setSlotLoading(false)
        setProfileError('')
      })
      .catch((requestError) => {
        if (!active) return
        if (requestError?.status === 404) { setProfile({}); setProfileError(''); setSlotLoading(false) }
        else setProfileError(errorMessage(requestError))
      })
      .finally(() => { if (active) setProfileLoading(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (view !== 'availability' || !profile) return
    const providerId = idOf(profile) || idOf(profile.provider)
    if (!providerId) return
    let active = true
    api.get(`/availability/${providerId}?date=${encodeURIComponent(selectedDate)}`)
      .then((data) => { if (active) setSlots(data?.availability?.slots || data?.slots || safeList(data, 'slots', 'availability')) })
      .catch((requestError) => { if (active) { setSlotError(errorMessage(requestError)); setSlots([]) } })
      .finally(() => { if (active) setSlotLoading(false) })
    return () => { active = false }
  }, [view, profile, selectedDate])

  async function saveProfile(event) {
    event.preventDefault()
    setBusy(true); setNotice(''); setProfileError('')
    const data = new FormData(event.currentTarget)
    const pincodes = String(data.get('servicePincodes') || '').split(/[\s,]+/).map((part) => part.trim()).filter((part) => /^\d{6}$/.test(part))
    const categories = String(data.get('categories') || '').split(',').map((part) => part.trim()).filter(Boolean)
    if (!pincodes.length) { setProfileError('Add at least one valid 6-digit PIN code where you serve.'); setBusy(false); return }
    if (!categories.length) { setProfileError('Add at least one service category.'); setBusy(false); return }
    try {
      const result = await api.post('/providers/me', { businessName: String(data.get('businessName') || '').trim(), bio: String(data.get('bio') || '').trim(), categories, servicePincodes: pincodes })
      setProfile(result?.provider || result?.profile || result)
      setNotice('Your provider profile has been saved.')
    } catch (requestError) { setProfileError(errorMessage(requestError)) }
    finally { setBusy(false) }
  }

  async function startVerification() {
    if (!idOf(profile)) { setProfileError('Save your professional profile before starting verification.'); return }
    setBusy(true); setNotice(''); setProfileError(''); setVerificationUrl('')
    try {
      const result = await api.post('/providers/me/verification', {})
      if (result?.status) setProfile((current) => ({ ...current, verificationStatus: result.status, ...(result.provider ? { kycProvider: result.provider } : {}) }))
      const link = result?.redirectUrl || result?.verificationUrl || result?.url || result?.data?.redirectUrl || result?.data?.verificationUrl || ''
      setVerificationUrl(link)
      setNotice(link ? 'Your verification session is ready. Continue using the secure provider link.' : result?.message || 'Verification request received. Nearby will show an update when the verification provider responds.')
    } catch (requestError) { setProfileError(errorMessage(requestError, 'Verification is not available right now.')) }
    finally { setBusy(false) }
  }

  async function publishService(event) {
    event.preventDefault()
    setBusy(true); setNotice('')
    const pincodes = service.servicePincodes.split(/[\s,]+/).map((part) => part.trim()).filter((part) => /^\d{6}$/.test(part))
    if (!pincodes.length) { setProfileError('Add at least one valid 6-digit PIN code.'); setBusy(false); return }
    try {
      const result = await api.post('/services', { title: service.title.trim(), description: service.description.trim(), category: service.category.trim(), price: Number(service.price), durationMinutes: Number(service.durationMinutes), servicePincodes: pincodes })
      const created = result?.service || result
      setCreatedServices((existing) => [created, ...existing])
      setNotice('Your service was submitted to Nearby. Its visibility follows your provider verification status.')
      setService({ title: '', description: '', category: '', price: '', durationMinutes: '60', servicePincodes: '' })
      setProfileError('')
    } catch (requestError) { setProfileError(errorMessage(requestError)) }
    finally { setBusy(false) }
  }

  async function toggleService(serviceItem) {
    const serviceId = idOf(serviceItem)
    const isActive = serviceItem.isActive === false
    setBusy(true); setProfileError(''); setNotice('')
    try {
      const result = await api.patch(`/services/${encodeURIComponent(serviceId)}`, { isActive })
      const updated = result?.service || result
      setCreatedServices((current) => current.map((item) => idOf(item) === serviceId ? { ...item, ...updated } : item))
      setNotice(isActive ? 'Service listing reactivated.' : 'Service listing deactivated.')
    } catch (requestError) { setProfileError(errorMessage(requestError)) }
    finally { setBusy(false) }
  }

  function addSlot(event) {
    event.preventDefault()
    if (slotForm.endTime <= slotForm.startTime) { setSlotError('End time must be after start time.'); return }
    setSlotError('')
    setSlots((current) => [...current, { date: selectedDate, ...slotForm }].sort((a, b) => a.startTime.localeCompare(b.startTime)))
  }

  async function saveSlots() {
    setBusy(true); setNotice(''); setSlotError('')
    try {
      await api.put('/availability/me', { date: selectedDate, slots: slots.map(({ startTime, endTime }) => ({ startTime, endTime })) })
      setNotice('Availability saved for this date.')
    } catch (requestError) { setSlotError(errorMessage(requestError)) }
    finally { setBusy(false) }
  }

  if (profileLoading) return <LoadingState label="Loading your professional profile…" />
  const services = [...createdServices, ...safeList(profile, 'services')].filter((item, index, list) => list.findIndex((other) => idOf(other) && idOf(other) === idOf(item)) === index)
  const currentStatus = String(profile?.verificationStatus || profile?.status || (profile?.verified ? 'verified' : 'pending')).toLowerCase()

  return <>
    {notice && <div className="notice notice-success dismissible" role="status"><CheckCircle2 size={17} /> {notice}<button aria-label="Dismiss" onClick={() => setNotice('')}><X size={16} /></button></div>}
    {profileError && <div className="notice notice-error" role="alert">{profileError}</div>}
    {view === 'profile' && <><PageTitle eyebrow="YOUR WORK, YOUR PROFILE" title="Tell your neighborhood about you." description="A clear profile helps customers understand your experience and exact service area." /><div className="workspace-grid"><form className="dash-panel workspace-form" onSubmit={saveProfile}><label className="field"><span>Business or professional name</span><input name="businessName" required maxLength="100" defaultValue={profile?.businessName || ''} placeholder="Your business name" /></label><label className="field"><span>About your work</span><textarea name="bio" rows="3" maxLength="2000" defaultValue={profile?.bio || ''} placeholder="Experience, approach, and what customers can expect" /></label><label className="field"><span>Categories</span><input name="categories" required maxLength="240" defaultValue={(Array.isArray(profile?.categories) ? profile.categories : []).join(', ')} placeholder="Plumbing, home repairs" /><small className="field-help">Separate categories with commas.</small></label><label className="field"><span>PIN codes you serve</span><input name="servicePincodes" defaultValue={(Array.isArray(profile?.servicePincodes) ? profile.servicePincodes : []).join(', ')} placeholder="411001, 411002" /><small className="field-help">Use exact 6-digit Indian PIN codes, separated by commas.</small></label><button className="button button-primary" disabled={busy}>{busy ? <span className="spinner" /> : <>Save profile <ArrowRight size={16} /></>}</button></form><aside className="dash-panel dash-panel-yellow verification-side"><span className="verification-icon"><ShieldCheck size={22} /></span><span className="eyebrow">VERIFICATION</span><h2>Profile status</h2><Badge tone={statusTone(currentStatus)}>{currentStatus}</Badge><p>If a KYC provider is configured, identity documents stay with that provider. Nearby stores only verification status and reference data.</p>{!['verified', 'approved'].includes(currentStatus) && <button className="button button-dark" onClick={startVerification} disabled={busy}>{busy ? <span className="spinner" /> : <>Start verification <ArrowRight size={15} /></>}</button>}{verificationUrl && <a className="text-link" href={verificationUrl} target="_blank" rel="noreferrer">Continue secure verification <ArrowRight size={14} /></a>}<div className="safe-note"><ShieldCheck size={16} /> Do not upload identity documents here.</div></aside></div></>}
    {view === 'services' && <><PageTitle eyebrow="WHAT YOU DO" title="Your services." description="Add clear, fixed-price listings for skills you offer. Provider verification controls visibility." /><div className="workspace-grid"><form className="dash-panel workspace-form" onSubmit={publishService}><h2>Add a service</h2><label className="field"><span>Service title</span><input required maxLength="100" value={service.title} onChange={(e) => setService({ ...service, title: e.target.value })} placeholder="e.g. Kitchen tap repair" /></label><label className="field"><span>Category</span><input required maxLength="60" list="nearby-categories" value={service.category} onChange={(e) => setService({ ...service, category: e.target.value })} placeholder="e.g. Plumbing" /><datalist id="nearby-categories">{['Home repairs', 'Plumbing', 'Electrical', 'Cleaning', 'Painting', 'Tutoring', 'Tailoring', 'Appliance repair'].map((name) => <option key={name} value={name} />)}</datalist></label><label className="field"><span>Description</span><textarea required rows="3" maxLength="1000" value={service.description} onChange={(e) => setService({ ...service, description: e.target.value })} placeholder="Describe what this service includes" /></label><div className="form-two-col"><label className="field"><span>Price (₹)</span><input required type="number" min="1" step="0.01" value={service.price} onChange={(e) => setService({ ...service, price: e.target.value })} placeholder="1200" /></label><label className="field"><span>Duration (minutes)</span><input required type="number" min="15" step="15" value={service.durationMinutes} onChange={(e) => setService({ ...service, durationMinutes: e.target.value })} /></label></div><label className="field"><span>PIN codes served</span><input required value={service.servicePincodes} onChange={(e) => setService({ ...service, servicePincodes: e.target.value.replace(/[^\d,\s]/g, '') })} placeholder="411001, 411002" /><small className="field-help">Customers discover your service using an exact PIN code match.</small></label><button className="button button-primary" disabled={busy}>{busy ? <span className="spinner" /> : <>Submit service <ArrowRight size={16} /></>}</button></form><section className="dash-panel listed-services"><div className="panel-heading"><div><span className="eyebrow">YOUR OFFERINGS</span><h2>Added services</h2></div><BriefcaseBusiness size={19} /></div>{services.length ? <div className="provider-service-list">{services.map((item, index) => <div className="provider-service-item" key={idOf(item) || index}><span className="service-list-icon"><Wrench size={17} /></span><div><b>{item.title || item.name || 'Service'}</b><small>{item.category || 'Service'} · {formatMoney(item.price)}</small></div><Badge tone={item.isActive === false ? 'neutral' : 'success'}>{item.status || (item.isActive === false ? 'inactive' : 'listed')}</Badge><button type="button" className="button button-small button-quiet" disabled={busy} onClick={() => toggleService(item)}>{busy ? 'Saving…' : item.isActive === false ? 'Reactivate' : 'Deactivate'}</button></div>)}</div> : <EmptyState icon={BriefcaseBusiness} title="No service listings yet" description="Add a service with a clear price and exact service PIN codes." />}</section></div></>}
    {view === 'availability' && <><PageTitle eyebrow="YOUR SCHEDULE" title="Set your availability." description="Choose a date and the time windows when customers can request your service." /><div className="availability-layout"><section className="dash-panel availability-editor"><div className="availability-date"><label className="field"><span><CalendarDays size={15} /> Date</span><input type="date" min={localIndiaDate()} value={selectedDate} onChange={(event) => { setSelectedDate(event.target.value); setSlotLoading(true); setSlotError('') }} /></label><p>All times use India Standard Time (IST).</p></div>{slotError && <div className="notice notice-error" role="alert">{slotError}</div>}{slotLoading ? <LoadingState label="Loading your available slots…" /> : <div className="slot-list">{slots.length ? slots.map((slot, index) => <div className="slot-row" key={slot._id || `${slot.startTime}-${index}`}><span><Clock3 size={16} /> {slot.startTime} – {slot.endTime}</span><button className="icon-button" aria-label="Remove time slot" onClick={() => setSlots((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X size={16} /></button></div>) : <EmptyState icon={Clock3} title="No times added for this date" description="Add a time window so customers can request a booking." />}</div>}
      <form className="add-slot-form" onSubmit={addSlot}><label className="field"><span>From</span><input required type="time" value={slotForm.startTime} onChange={(event) => setSlotForm({ ...slotForm, startTime: event.target.value })} /></label><label className="field"><span>Until</span><input required type="time" value={slotForm.endTime} onChange={(event) => setSlotForm({ ...slotForm, endTime: event.target.value })} /></label><button className="button button-outline" type="submit"><Plus size={16} /> Add time</button></form><div className="availability-foot"><span><ShieldCheck size={15} /> Booking conflicts are checked by Nearby.</span><button className="button button-primary" onClick={saveSlots} disabled={busy}>{busy ? <span className="spinner" /> : <>Save availability <ArrowRight size={16} /></>}</button></div></section><aside className="dash-panel dash-panel-yellow"><span className="eyebrow">SCHEDULING TIP</span><h2>Leave a little breathing room.</h2><p>Only offer windows you can reliably make. Nearby checks conflicting bookings when a customer requests a time.</p><div className="availability-calendar-icon"><CalendarDays size={25} /></div></aside></div></>}
  </>
}

function ChatPanel({ bookings, initialBookingId = '' }) {
  const eligible = bookings.filter((booking) => ['accepted', 'awaiting payment', 'confirmed', 'completion pending', 'completed', 'disputed'].includes(bookingStatus(booking)))
  const [selectedId, setSelectedId] = useState(() => eligible.some((booking) => idOf(booking) === initialBookingId) ? initialBookingId : idOf(eligible[0]) || '')
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [realtime, setRealtime] = useState(false)
  const socketRef = useRef(null)
  const realtimeRef = useRef(false)

  const readMessages = useCallback(async () => {
    if (!selectedId) return
    try {
      const data = await api.get(`/messages/${encodeURIComponent(selectedId)}`)
      setMessages(safeList(data, 'messages'))
      setError('')
    } catch (requestError) { setError(errorMessage(requestError)) }
  }, [selectedId])
  useEffect(() => {
    if (!selectedId) return
    let active = true
    realtimeRef.current = false
    api.get(`/messages/${encodeURIComponent(selectedId)}`)
      .then((data) => { if (active) { setMessages(safeList(data, 'messages')); setError('') } })
      .catch((requestError) => { if (active) setError(errorMessage(requestError)) })
      .finally(() => { if (active) setLoading(false) })
    const socket = io(socketOrigin(), { auth: { token: getToken() }, reconnection: true, reconnectionDelayMax: 5000 })
    socketRef.current = socket
    const joinBooking = () => {
      realtimeRef.current = false
      setRealtime(false)
      socket.emit('booking:join', { bookingId: selectedId }, (ack) => {
        if (!active) return
        if (ack?.success) {
          realtimeRef.current = true
          setRealtime(true)
          readMessages()
        } else {
          setError(ack?.error?.message || 'This booking conversation is not available to your account.')
        }
      })
    }
    const onMessage = (message) => {
      const bookingRef = typeof message?.booking === 'string' ? message.booking : idOf(message?.booking) || message?.bookingId
      if (String(bookingRef) !== String(selectedId)) return
      setMessages((current) => {
        const messageId = idOf(message)
        if (messageId && current.some((item) => idOf(item) === messageId)) return current
        return [...current, message]
      })
    }
    socket.on('connect', joinBooking)
    socket.on('disconnect', () => { realtimeRef.current = false; setRealtime(false); readMessages() })
    socket.on('connect_error', () => { realtimeRef.current = false; setRealtime(false) })
    socket.on('message:new', onMessage)
    socket.connect()
    const timer = window.setInterval(() => { if (!realtimeRef.current) readMessages() }, 12000)
    return () => {
      active = false
      window.clearInterval(timer)
      realtimeRef.current = false
      socket.removeAllListeners()
      socket.disconnect()
      if (socketRef.current === socket) socketRef.current = null
    }
  }, [selectedId, readMessages])

  async function send(event) {
    event.preventDefault()
    if (!text.trim() || !selectedId) return
    setSending(true); setError('')
    try {
      let result
      if (realtimeRef.current && socketRef.current?.connected) {
        result = await new Promise((resolve, reject) => {
          socketRef.current.timeout(8000).emit('message:send', { bookingId: selectedId, text: text.trim() }, (timeoutError, ack) => {
            if (timeoutError) { reject(new Error('Message delivery could not be confirmed. Please try again.')); return }
            if (!ack?.success) { reject(new Error(ack?.error?.message || 'Message could not be sent.')); return }
            resolve(ack.data || {})
          })
        })
      } else {
        result = await api.post(`/messages/${encodeURIComponent(selectedId)}`, { text: text.trim() })
      }
      const posted = result?.message
      if (posted) setMessages((current) => { const postedId = idOf(posted); return postedId && current.some((message) => idOf(message) === postedId) ? current : [...current, posted] })
      else await readMessages()
      setText('')
    } catch (requestError) { setError(errorMessage(requestError)) }
    finally { setSending(false) }
  }

  return <><PageTitle eyebrow="BOOKING CONVERSATIONS" title="Messages." description="Keep service conversations tied to their booking." />
    {!eligible.length ? <EmptyState icon={MessageSquare} title="Messages open after acceptance" description="Once a provider accepts a booking, the customer and provider can chat here." /> : <div className="chat-layout"><aside className="chat-bookings"><span className="eyebrow">YOUR BOOKINGS</span>{eligible.map((booking) => <button className={selectedId === idOf(booking) ? 'chat-booking selected' : 'chat-booking'} key={idOf(booking)} onClick={() => { setSelectedId(idOf(booking)); setMessages([]); setLoading(true); setRealtime(false) }}><span className="mini-booking-icon"><Wrench size={15} /></span><span><b>{bookingName(booking)}</b><small>{bookingDate(booking)}</small></span></button>)}</aside><section className="chat-window"><div className="chat-window-heading"><div className="mini-booking-icon"><MessageSquare size={16} /></div><span><b>{bookingName(eligible.find((booking) => idOf(booking) === selectedId) || {})}</b><small>{realtime ? 'Live connection' : 'Reconnecting · messages refresh while offline'}</small></span></div>{error && <div className="notice notice-error" role="alert">{error}</div>}{loading ? <LoadingState label="Loading messages…" /> : <div className="chat-messages">{messages.length ? messages.map((message, index) => <div className="chat-message" key={message._id || message.id || index}><p>{message.text || message.body || ''}</p><small>{message.sender?.name || message.senderName || 'Nearby participant'}{message.createdAt ? ` · ${new Intl.DateTimeFormat('en-IN', { timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(message.createdAt))}` : ''}</small></div>) : <EmptyState icon={MessageCircle} title="Say hello" description="Use this space to coordinate details for the booking." />}</div>}<form className="chat-compose" onSubmit={send}><label className="sr-only" htmlFor="chat-input">Write a message</label><input id="chat-input" value={text} maxLength={1000} onChange={(event) => setText(event.target.value)} placeholder="Write a message…" /><button className="button button-primary button-icon" disabled={sending || !text.trim()} aria-label="Send message">{sending ? <span className="spinner" /> : <Send size={17} />}</button></form><p className="chat-privacy"><ShieldCheck size={13} /> Messages are limited to the booking participants.</p></section></div>}
  </>
}

function AdminProviders() {
  const [providers, setProviders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    api.get('/admin/providers').then((data) => { if (active) { setProviders(safeList(data, 'providers')); setError('') } }).catch((e) => { if (active) setError(errorMessage(e)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [attempt])
  return <><PageTitle eyebrow="PROVIDER TRUST" title="Provider profiles." description="View identity verification status and attach a Razorpay Route account when provided by the professional." />{loading ? <LoadingState label="Loading provider profiles…" /> : error ? <ErrorState message={error} onRetry={() => setAttempt((value) => value + 1)} /> : providers.length ? <div className="admin-list">{providers.map((provider, index) => <AdminProviderCard key={idOf(provider) || index} provider={provider} />)}</div> : <EmptyState icon={Users} title="No provider profiles found" description="Provider accounts will be listed here for review." />}</>
}

function AdminProviderCard({ provider }) {
  const [routeAccountId, setRouteAccountId] = useState('')
  const [configured, setConfigured] = useState(Boolean(provider.razorpayAccountConfigured))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [verificationStatus, setVerificationStatus] = useState(String(provider.verificationStatus || provider.status || (provider.verified ? 'verified' : 'pending')).toLowerCase())
  const [verificationBusy, setVerificationBusy] = useState(false)
  const [verificationError, setVerificationError] = useState('')
  const [verificationNotice, setVerificationNotice] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')
  const status = verificationStatus
  const id = idOf(provider)
  const kycProvider = String(provider.kycProvider || '').toLowerCase()
  const canReview = Boolean(provider.kycProvider && provider.hasKycReference) && ['pending', 'in_review'].includes(status)
  const canApprove = canReview && !['development_stub', 'disabled'].includes(kycProvider)

  async function updateRouteAccount(value) {
    setBusy(true); setError('')
    try {
      const result = await api.patch(`/admin/providers/${encodeURIComponent(id)}/route-account`, { razorpayAccountId: value })
      const data = result?.provider || result
      setConfigured(Boolean(data?.razorpayAccountConfigured))
      setRouteAccountId('')
    } catch (requestError) { setError(errorMessage(requestError)) }
    finally { setBusy(false) }
  }

  async function reviewVerification(nextStatus) {
    setVerificationBusy(true); setVerificationError(''); setVerificationNotice('')
    try {
      const payload = { status: nextStatus }
      if (nextStatus === 'rejected') payload.reason = rejectionReason.trim()
      const result = await api.patch(`/admin/providers/${encodeURIComponent(id)}/verification`, payload)
      const updated = result?.provider || result
      setVerificationStatus(String(updated?.verificationStatus || nextStatus).toLowerCase())
      setRejecting(false)
      setRejectionReason('')
      setVerificationNotice(nextStatus === 'verified' ? 'Provider approved after vendor verification.' : 'Provider rejection recorded.')
    } catch (requestError) { setVerificationError(errorMessage(requestError)) }
    finally { setVerificationBusy(false) }
  }

  return <article className="admin-list-card admin-provider-card"><div className="admin-provider-summary"><div className="provider-avatar">{(provider.businessName || provider.user?.name || provider.name || 'P').slice(0, 1).toUpperCase()}</div><div className="admin-provider-data"><h3>{provider.businessName || provider.user?.name || provider.name || 'Provider profile'}</h3><p>{provider.user?.email || provider.email || 'Email not provided'}{provider.city ? ` · ${provider.city}` : ''}</p><small>{(provider.servicePincodes || provider.pincodes || []).join?.(', ') || 'No PIN codes listed'}{provider.kycProvider ? ` · Verification provider: ${provider.kycProvider}` : ''}{provider.hasKycReference ? ' · Vendor session reference on file' : ''}</small></div><Badge tone={statusTone(status)}>{status}</Badge></div>{canReview ? <div className="provider-review-controls"><div><b>Vendor verification review</b><small>Approve only after the external KYC result is confirmed. Nearby does not store identity documents or show vendor references.</small></div><div className="provider-review-actions">{canApprove && <button type="button" className="button button-small button-primary" disabled={verificationBusy} onClick={() => reviewVerification('verified')}>{verificationBusy ? <span className="spinner" /> : 'Approve provider'}</button>}<button type="button" className="button button-small button-outline" disabled={verificationBusy} onClick={() => setRejecting((current) => !current)}>Reject profile</button></div>{!canApprove && <small className="provider-review-hint">Approval is unavailable for the development or disabled KYC adapter. Rejection remains available when a vendor session is on file.</small>}{rejecting && <form className="inline-form" onSubmit={(event) => { event.preventDefault(); reviewVerification('rejected') }}><label className="field"><span>Reason for rejection</span><textarea required minLength={10} maxLength={500} rows={2} value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} placeholder="Summarize the vendor review reason (10–500 characters)" /></label><button type="submit" className="button button-small button-dark" disabled={verificationBusy || rejectionReason.trim().length < 10}>{verificationBusy ? <span className="spinner" /> : 'Confirm rejection'}</button></form>}</div> : <div className="provider-review-status"><b>Vendor verification review</b><small>{['pending', 'in_review'].includes(status) ? 'Decision controls are unavailable until a KYC provider and session reference are recorded.' : 'Verification decision is read-only after review.'}</small></div>}{verificationNotice && <div className="notice notice-success" role="status">{verificationNotice}</div>}{verificationError && <div className="notice notice-error" role="alert">{verificationError}</div>}<div className="route-account-row"><div><b>Razorpay Route account</b><small>{configured ? 'Configured · account ID hidden' : 'Not configured'}</small></div><form onSubmit={(event) => { event.preventDefault(); if (routeAccountId.trim()) updateRouteAccount(routeAccountId.trim()) }}><label className="sr-only" htmlFor={`route-${id}`}>Razorpay Route account ID</label><input id={`route-${id}`} value={routeAccountId} onChange={(event) => setRouteAccountId(event.target.value)} placeholder={configured ? 'Enter a new account ID to replace' : 'Enter linked account ID'} autoComplete="off" /><button type="submit" className="button button-small button-outline" disabled={busy || !routeAccountId.trim()}>{busy ? <span className="spinner" /> : configured ? 'Update' : 'Attach'}</button>{configured && <button type="button" className="button button-small button-quiet" disabled={busy} onClick={() => updateRouteAccount(null)}>Remove</button>}</form></div>{error && <div className="notice notice-error" role="alert">{error}</div>}</article>
}

function DisputeCard({ dispute, onResolve, busy }) {
  const [resolution, setResolution] = useState('provider_favor')
  const [note, setNote] = useState('')
  const [refundPercent, setRefundPercent] = useState('50')
  const id = idOf(dispute)
  const status = String(dispute.status || 'open').toLowerCase()
  const booking = dispute.booking || {}
  const customer = dispute.customer || booking.customer || {}
  const provider = dispute.provider || booking.provider || {}
  const resolved = ['resolved', 'closed'].includes(status)
  return <article className="dispute-card"><div className="dispute-card-top"><span className="dispute-icon"><LifeBuoy size={18} /></span><Badge tone={statusTone(status)}>{status}</Badge></div><h3>{dispute.subject || dispute.title || booking.service?.title || booking.serviceName || `Booking ${dispute.bookingId || booking._id || ''}`}</h3><p>{dispute.reason || dispute.description || 'No additional details provided.'}</p><div className="dispute-meta"><span><ClipboardList size={14} /> {booking.service?.title || booking.serviceName || dispute.bookingId || booking._id || 'Booking details'}</span><span><UserRound size={14} /> Customer: {customer.name || customer.email || 'Not included'}</span><span><BriefcaseBusiness size={14} /> Provider: {provider.businessName || provider.name || provider.email || 'Not included'}</span><span><Clock3 size={14} /> {dispute.createdAt ? bookingDate({ scheduledAt: dispute.createdAt }) : 'Recently reported'}</span></div>{dispute.note && <p className="resolution-note">Latest note: {dispute.note}</p>}{!resolved && <form className="dispute-resolution-form" onSubmit={(event) => { event.preventDefault(); onResolve(id, { status: 'resolved', resolution, ...(resolution === 'partial_refund' ? { refundBps: Math.round(Number(refundPercent) * 100) } : {}), note: note.trim() }) }}><label className="field"><span>Resolution</span><select value={resolution} onChange={(event) => setResolution(event.target.value)}><option value="provider_favor">Provider favor — no refund</option><option value="customer_refund">Customer refund — full refund</option><option value="partial_refund">Partial refund</option></select></label>{resolution === 'partial_refund' && <label className="field"><span>Refund percentage</span><input type="number" min="1" max="99" step="1" required value={refundPercent} onChange={(event) => setRefundPercent(event.target.value)} /></label>}<label className="field"><span>Resolution note</span><textarea rows="2" minLength="4" maxLength="700" required value={note} onChange={(event) => setNote(event.target.value)} placeholder="Record the decision and the reason" /></label><button className="button button-small button-primary" type="submit" disabled={busy}>{busy ? <span className="spinner" /> : <>Resolve dispute <CheckCircle2 size={15} /></>}</button></form>}</article>
}

function AdminDisputes() {
  const [disputes, setDisputes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [notice, setNotice] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    api.get('/admin/disputes').then((data) => { if (active) { setDisputes(safeList(data, 'disputes')); setError('') } }).catch((e) => { if (active) setError(errorMessage(e)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [attempt])
  async function resolve(disputeId, payload) {
    setBusyId(disputeId); setError(''); setNotice('')
    try {
      const result = await api.patch(`/disputes/${encodeURIComponent(disputeId)}`, payload)
      const updated = result?.dispute || result
      setDisputes((current) => current.map((item) => idOf(item) === disputeId ? { ...item, ...updated, status: 'resolved' } : item))
      setNotice('Dispute resolution recorded.')
    } catch (requestError) { setError(errorMessage(requestError)) }
    finally { setBusyId('') }
  }
  return <><PageTitle eyebrow="CUSTOMER SUPPORT" title="Dispute queue." description="Review participant details, then record a reasoned resolution for each case." />{notice && <div className="notice notice-success"><CheckCircle2 size={16} /> {notice}</div>}{loading ? <LoadingState label="Loading disputes…" /> : error ? <ErrorState message={error} onRetry={() => setAttempt((value) => value + 1)} /> : disputes.length ? <div className="dispute-list">{disputes.map((dispute, index) => <DisputeCard key={idOf(dispute) || index} dispute={dispute} onResolve={resolve} busy={busyId === idOf(dispute)} />)}</div> : <EmptyState icon={LifeBuoy} title="No open disputes" description="New customer and provider concerns will appear here for review." />}</>
}

function AdminAudit() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => { let active = true; api.get('/admin/audit').then((data) => { if (active) setEvents(safeList(data, 'events', 'audit')) }).catch((e) => { if (active) setError(errorMessage(e)) }).finally(() => { if (active) setLoading(false) }); return () => { active = false } }, [attempt])
  return <><PageTitle eyebrow="ACCOUNTABILITY" title="Marketplace activity." description="A read-only view of recent administrative and payment actions recorded by Nearby." />{loading ? <LoadingState label="Loading activity…" /> : error ? <ErrorState message={error} onRetry={() => setAttempt((value) => value + 1)} /> : events.length ? <div className="audit-list">{events.map((event, index) => <article className="audit-row" key={event._id || event.id || index}><span className="audit-icon"><Activity size={16} /></span><div><b>{event.action || event.event || 'Marketplace event'}</b><p>{event.description || event.message || event.actor?.email || 'System recorded activity'}</p></div><small>{event.createdAt ? bookingDate({ scheduledAt: event.createdAt }) : ''}</small></article>)}</div> : <EmptyState icon={FileText} title="No audit entries yet" description="Recorded administrative and payment actions will appear here." />}</>
}

const SETTING_KEYS = ['commissionBps', 'checkoutTimeoutMinutes', 'completionReviewHours', 'razorpayRouteEnabled']
const CANCELLATION_SETTING_KEYS = ['customerEarlyWindowHours', 'customerEarlyRefundBps', 'customerLateRefundBps', 'providerCancelRefundBps']

function flattenSettings(value) {
  const fields = SETTING_KEYS.filter((key) => Object.hasOwn(value || {}, key)).map((key) => [key, value[key]])
  const policy = value?.cancellationPolicy || {}
  for (const key of CANCELLATION_SETTING_KEYS) if (Object.hasOwn(policy, key)) fields.push([`cancellationPolicy.${key}`, policy[key]])
  return fields
}

function AdminSettings() {
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => { let active = true; api.get('/settings/admin').then((data) => { if (active) { setSettings(data?.settings || data); setError('') } }).catch((e) => { if (active) setError(errorMessage(e)) }).finally(() => { if (active) setLoading(false) }); return () => { active = false } }, [attempt])
  const editable = useMemo(() => flattenSettings(settings), [settings])
  async function save(event) {
    event.preventDefault()
    if (!settings) return
    setBusy(true); setNotice('')
    const formData = new FormData(event.currentTarget)
    const payload = {}
    const cancellationPolicy = {}
    for (const [key, rawValue] of formData.entries()) {
      const nested = key.startsWith('cancellationPolicy.')
      const settingKey = nested ? key.slice('cancellationPolicy.'.length) : key
      const current = nested ? settings.cancellationPolicy?.[settingKey] : settings[settingKey]
      const numeric = typeof current === 'number' || (current === null && settingKey !== 'razorpayRouteEnabled')
      const value = typeof current === 'boolean' ? rawValue === 'true' : numeric ? (rawValue === '' ? null : Number(rawValue)) : rawValue
      if (nested) cancellationPolicy[settingKey] = value
      else payload[settingKey] = value
    }
    if (Object.keys(cancellationPolicy).length) payload.cancellationPolicy = cancellationPolicy
    try { const data = await api.patch('/settings/admin', payload); setSettings(data?.settings || data || settings); setNotice('Marketplace settings saved.') }
    catch (e) { setError(errorMessage(e)) }
    finally { setBusy(false) }
  }
  const labelFor = (key) => key.split('.').map((part) => part.replace(/([A-Z])/g, ' $1').replace(/[_-]/g, ' ')).join(' / ').replace(/^./, (letter) => letter.toUpperCase())
  const helpFor = (key) => key === 'commissionBps' ? 'Basis points (100 bps = 1%); maximum 5,000 bps.' : key.endsWith('Bps') ? 'Basis points (10,000 bps = 100%).' : key === 'checkoutTimeoutMinutes' ? '1 to 120 minutes.' : key === 'completionReviewHours' ? '1 to 720 hours.' : key.endsWith('Hours') ? '0 to 8,760 hours.' : ''
  const minFor = (key) => ['checkoutTimeoutMinutes', 'completionReviewHours'].includes(key) ? 1 : 0
  const maxFor = (key) => key === 'commissionBps' ? 5000 : key.endsWith('RefundBps') ? 10000 : key === 'checkoutTimeoutMinutes' ? 120 : key === 'completionReviewHours' ? 720 : key.endsWith('Hours') ? 8760 : undefined
  return <><PageTitle eyebrow="MARKETPLACE RULES" title="Settings and safeguards." description="Set commission, payment timing, and nested cancellation/refund rules before launch." />{notice && <div className="notice notice-success"><CheckCircle2 size={16} /> {notice}</div>}{loading ? <LoadingState label="Loading marketplace settings…" /> : error ? <ErrorState message={error} onRetry={() => setAttempt((value) => value + 1)} /> : editable.length ? <form className="dash-panel settings-form" onSubmit={save}><div className="settings-info"><ShieldCheck size={19} /><p>Only supported settings are sent. Blank optional numeric values remain unset. Route credentials and private secrets are never shown here.</p></div><div className="settings-grid">{editable.map(([key, value]) => { const numeric = typeof value === 'number' || value === null; return <label className="field" key={key}><span>{labelFor(key)}</span>{key === 'razorpayRouteEnabled' ? <select name={key} defaultValue={String(value)}><option value="true">Enabled</option><option value="false">Disabled</option></select> : <input name={key} type={numeric ? 'number' : 'text'} min={numeric ? minFor(key) : undefined} max={maxFor(key)} step={numeric ? 1 : undefined} defaultValue={value ?? ''} />}{helpFor(key) && <small className="field-help">{helpFor(key)}</small>}</label> })}</div><button className="button button-primary" disabled={busy}>{busy ? <span className="spinner" /> : <>Save settings <ArrowRight size={16} /></>}</button></form> : <div className="notice notice-warning"><CircleAlert size={17} /><span>Marketplace settings are not configured yet. Set commission, cancellation and refund rules, checkout timeout, and completion review window on the server before launch.</span></div>}</>
}

function AccountSettings() {
  const { setUser } = useSession()
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    api.get('/users/me')
      .then((data) => { if (active) { setProfile(data?.user || data); setError('') } })
      .catch((requestError) => { if (active) setError(errorMessage(requestError)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [attempt])

  async function save(event) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const payload = {
      name: String(formData.get('name') || '').trim(),
      phone: String(formData.get('phone') || '').trim(),
      countryCode: String(formData.get('countryCode') || '').trim(),
    }
    setBusy(true); setNotice(''); setError('')
    try {
      const data = await api.patch('/users/me', payload)
      const updated = data?.user || data?.profile || data
      setProfile(updated)
      setUser((current) => ({ ...current, ...updated }))
      setNotice('Your profile settings have been saved.')
    } catch (requestError) { setError(errorMessage(requestError)) }
    finally { setBusy(false) }
  }

  const roleLabel = { customer: 'Customer', provider: 'Service professional', admin: 'Administrator' }
  if (loading) return <LoadingState label="Loading your account settings…" />
  if (!profile) return <><PageTitle eyebrow="YOUR ACCOUNT" title="Profile settings." description="Keep your account details up to date." /><ErrorState message={error || 'Your profile could not be loaded.'} onRetry={() => setAttempt((value) => value + 1)} /></>

  return <><PageTitle eyebrow="YOUR ACCOUNT" title="Profile settings." description="Manage the details attached to your Nearby account." />{notice && <div className="notice notice-success" role="status"><CheckCircle2 size={16} /> {notice}</div>}{error && <div className="notice notice-error" role="alert">{error}</div>}<form className="dash-panel settings-form account-settings" onSubmit={save}><div className="settings-info"><ShieldCheck size={19} /><p>Your email and account role are read-only in profile settings. Email changes aren't available here.</p></div><div className="settings-grid"><label className="field"><span>Full name</span><input name="name" required minLength={1} maxLength={100} value={profile.name || ''} onChange={(event) => setProfile((current) => ({ ...current, name: event.target.value }))} autoComplete="name" /></label><label className="field"><span>Email address</span><input type="email" value={profile.email || ''} readOnly aria-describedby="account-email-help" /><small className="field-help" id="account-email-help">This address is used to sign in.</small></label><label className="field"><span>Phone number <small>(optional)</small></span><span className="phone-field"><input className="country-code-input" name="countryCode" aria-label="Country calling code" value={profile.countryCode || '+91'} onChange={(event) => setProfile((current) => ({ ...current, countryCode: event.target.value.replace(/[^+\d]/g, '').slice(0, 4) }))} pattern="\+\d{1,3}" title="Use a country code such as +91." autoComplete="tel-country-code" /><input name="phone" type="tel" inputMode="numeric" maxLength={15} pattern="[0-9]{7,15}" value={profile.phone || ''} onChange={(event) => setProfile((current) => ({ ...current, phone: event.target.value.replace(/\D/g, '').slice(0, 15) }))} autoComplete="tel-national" placeholder="Phone number" /></span><small className="field-help">Leave blank to remove your phone number from your account.</small></label><div className="field"><span>Account type</span><input value={roleLabel[profile.role] || 'Nearby account'} readOnly /></div></div><button className="button button-primary" disabled={busy}>{busy ? <span className="spinner" /> : <>Save profile settings <ArrowRight size={16} /></>}</button></form></>
}

export default function Dashboard() {
  const { user } = useSession()
  const role = getRole(user)
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const view = params.get('view') || 'overview'
  const [bookings, setBookings] = useState([])
  const [bookingsLoading, setBookingsLoading] = useState(role !== 'admin')
  const [bookingsError, setBookingsError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [notice, setNotice] = useState('')
  const [noticeTone, setNoticeTone] = useState('success')
  const [stats, setStats] = useState(null)
  const [statsError, setStatsError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const items = NAV_ITEMS[role] || NAV_ITEMS.customer

  const refreshBookings = useCallback(async () => {
    try {
      const data = await api.get('/bookings')
      setBookings(safeList(data, 'bookings'))
      setBookingsError('')
    } catch (requestError) { setBookingsError(errorMessage(requestError)) }
    finally { setBookingsLoading(false) }
  }, [])

  useEffect(() => {
    if (role === 'admin') return
    let active = true
    api.get('/bookings')
      .then((data) => { if (active) { setBookings(safeList(data, 'bookings')); setBookingsError('') } })
      .catch((requestError) => { if (active) setBookingsError(errorMessage(requestError)) })
      .finally(() => { if (active) setBookingsLoading(false) })
    return () => { active = false }
  }, [role, attempt])
  useEffect(() => {
    if (role !== 'admin' || view !== 'overview') return
    let active = true
    api.get('/admin/stats').then((data) => { if (active) { setStats(data?.stats || data); setStatsError('') } }).catch((e) => { if (active) setStatsError(errorMessage(e)) })
    return () => { active = false }
  }, [role, view, attempt])

  function setView(next) {
    setParams(next === 'overview' ? {} : { view: next })
  }

  async function action(bookingId, operation) {
    if (!bookingId) return
    setBusyId(bookingId); setNotice(''); setBookingsError('')
    try {
      if (operation === 'checkout') { await checkout(bookingId); return }
      await api.post(`/bookings/${encodeURIComponent(bookingId)}/${operation}`, {})
      setNotice(operation === 'complete' ? 'Booking marked complete.' : operation === 'accept' ? 'Booking accepted.' : operation === 'reject' ? 'Booking declined.' : 'Booking updated.')
      await refreshBookings()
    } catch (requestError) { setBookingsError(errorMessage(requestError)) }
    finally { setBusyId('') }
  }

  const checkout = async (bookingId) => {
    const result = await api.post(`/bookings/${encodeURIComponent(bookingId)}/checkout`, {})
    const checkoutData = result?.checkout || result?.order || result
    const key = checkoutData?.keyId || checkoutData?.key || checkoutData?.key_id
    const orderId = checkoutData?.orderId || checkoutData?.order_id || checkoutData?.id
    if (!key || !orderId) {
      setNoticeTone('warning')
      setNotice('Online checkout is not configured for this booking yet. No payment was taken; please try again later or contact Nearby support.')
      return
    }
    const available = await loadCheckoutScript()
    if (!available) throw new Error('Secure checkout could not load. Your accepted booking is unchanged; try again when your connection is stable.')
    await new Promise((resolve, reject) => {
      const options = {
        key,
        order_id: orderId,
        amount: checkoutData.amount,
        currency: checkoutData.currency || 'INR',
        name: 'Nearby',
        description: 'Nearby service booking',
        prefill: { name: user?.name || user?.fullName || '', email: user?.email || '', contact: user?.phone || '' },
        notes: { bookingId },
        theme: { color: '#1557FF' },
        handler: async (payment) => {
          try {
            await api.post(`/payments/${encodeURIComponent(bookingId)}/verify`, {
              razorpay_order_id: payment.razorpay_order_id,
              razorpay_payment_id: payment.razorpay_payment_id,
              razorpay_signature: payment.razorpay_signature,
            })
            setNoticeTone('success')
            setNotice('Payment details submitted. Your booking will update after secure verification.')
            await refreshBookings()
            resolve()
          } catch (requestError) {
            setNoticeTone('warning')
            setNotice(`Payment details were submitted, but confirmation is still pending: ${errorMessage(requestError)}`)
            await refreshBookings()
            resolve()
          }
        },
        modal: { ondismiss: () => resolve() },
      }
      try { const modal = new window.Razorpay(options); modal.on('payment.failed', (failure) => reject(new Error(failure?.error?.description || 'Payment could not be completed.'))); modal.open() }
      catch (error) { reject(error) }
    })
  }

  async function submitReview(bookingId, rating, comment) {
    try {
      await api.post('/reviews', { bookingId, rating, comment })
      setNotice('Thank you. Your review has been submitted.')
      await refreshBookings()
    } catch (requestError) { setBookingsError(errorMessage(requestError)) }
  }

  async function submitDispute(bookingId, reason) {
    try {
      await api.post('/disputes', { bookingId, reason })
      setNotice('Your dispute has been sent for review.')
      await refreshBookings()
    } catch (requestError) { setBookingsError(errorMessage(requestError)) }
  }

  useEffect(() => {
    if (!items.some((item) => item.id === view)) setParams({})
  }, [items, setParams, view])
  const selected = items.find((item) => item.id === view)
  const DashboardIcon = selected?.icon || LayoutDashboard

  return <div className="dashboard-app"><DashboardHeader /><div className="dashboard-layout"><aside className="dashboard-sidebar"><div className="sidebar-context"><span className="sidebar-role-icon"><DashboardIcon size={18} /></span><span><b>{ROLE_LABEL[role] || ROLE_LABEL.customer}</b><small>{user?.email || ''}</small></span></div><nav className="dashboard-nav" aria-label="Dashboard navigation">{items.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? 'dashboard-nav-item active' : 'dashboard-nav-item'} onClick={() => setView(id)}><Icon size={18} /><span>{label}</span>{id === 'bookings' && role !== 'admin' && bookings.filter((booking) => ['pending', 'requested'].includes(bookingStatus(booking))).length > 0 && <small>{bookings.filter((booking) => ['pending', 'requested'].includes(bookingStatus(booking))).length}</small>}</button>)}</nav><div className="sidebar-bottom"><Link to="/services"><SearchIcon /> Browse services</Link><button onClick={() => navigate('/')}><LogOut size={16} /> Back to Nearby</button></div></aside>
      <main className="dashboard-main"><div className="dashboard-content">{notice && <div className={`notice notice-${noticeTone} dismissible`} role="status"><CheckCircle2 size={17} /> {notice}<button aria-label="Dismiss" onClick={() => setNotice('')}><X size={16} /></button></div>}
        {role === 'admin' ? <>
          {view === 'overview' && (statsError ? <ErrorState message={statsError} onRetry={() => setAttempt((value) => value + 1)} /> : <Overview role={role} user={user} bookings={[]} stats={stats} setView={setView} />)}
          {view === 'providers' && <AdminProviders />}{view === 'disputes' && <AdminDisputes />}{view === 'audit' && <AdminAudit />}{view === 'account' && <AccountSettings />}{view === 'settings' && <AdminSettings />}
        </> : <>
          {view === 'overview' && <Overview role={role} user={user} bookings={bookings} stats={stats} setView={setView} />}
          {view === 'bookings' && <><PageTitle eyebrow={role === 'provider' ? 'CUSTOMER REQUESTS' : 'YOUR BOOKINGS'} title={role === 'provider' ? 'Booking requests.' : 'The things on your list.'} description={role === 'provider' ? 'Accept a request to open the booking conversation and payment flow.' : 'Follow each request from provider response through completion.'} action={<button className="button button-small button-outline" onClick={() => setAttempt((value) => value + 1)}><Activity size={15} /> Refresh</button>} />{bookingsLoading ? <LoadingState label="Loading bookings…" /> : bookingsError ? <ErrorState message={bookingsError} onRetry={() => setAttempt((value) => value + 1)} /> : <BookingList bookings={bookings} role={role} onAction={action} busyId={busyId} onReview={submitReview} onDispute={submitDispute} onMessages={(bookingId) => { setView('messages'); setParams({ view: 'messages', bookingId }) }} />}</>}
          {view === 'messages' && (bookingsLoading ? <LoadingState label="Loading bookings…" /> : bookingsError ? <ErrorState message={bookingsError} onRetry={() => setAttempt((value) => value + 1)} /> : <ChatPanel bookings={bookings} initialBookingId={params.get('bookingId') || ''} />)}
          {view === 'account' && <AccountSettings />}
          {role === 'provider' && ['profile', 'services', 'availability'].includes(view) && <ProviderWorkspace key={view} view={view} />}
        </>}
      </div><footer className="dashboard-footer"><span>NEARBY · INDIA</span><span>Clear local connections, one booking at a time.</span></footer></main></div></div>
}

function SearchIcon() { return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg> }
