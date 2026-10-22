import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, BadgeCheck, CalendarDays, CheckCircle2, Clock3, MapPin, MessageSquare, ShieldCheck, Star } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ErrorState, Footer, LoadingState, SiteHeader } from '../components/AppChrome.jsx'
import { api, asList, errorMessage, formatMoney, idOf } from '../services/api.js'
import { useSession } from '../services/useSession.js'
import { getRole } from '../services/roles.js'

function kolkataDate(date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const get = (type) => parts.find((part) => part.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

function tomorrowInKolkata() { return kolkataDate(new Date(Date.now() + 86400000)) }

function slotStartTimestamp(slot, date) {
  if (slot?.startsAt) {
    const timestamp = new Date(slot.startsAt).getTime()
    if (Number.isFinite(timestamp)) return timestamp
  }
  const start = slot?.startTime || slot?.start || slot?.time
  if (typeof start !== 'string') return Number.NaN
  const slotDate = slot.date || date
  const timestamp = /^\d{2}:\d{2}$/.test(start)
    ? new Date(`${slotDate}T${start}:00+05:30`).getTime()
    : new Date(start).getTime()
  return timestamp
}

function DetailIcon({ children }) { return <span className="detail-icon">{children}</span> }

export default function ServiceDetail() {
  const { serviceId } = useParams()
  const { user } = useSession()
  const navigate = useNavigate()
  const [service, setService] = useState(null)
  const [provider, setProvider] = useState(null)
  const [reviews, setReviews] = useState([])
  const [loadResult, setLoadResult] = useState({ serviceId: '', error: '' })
  const [availabilityResult, setAvailabilityResult] = useState({ key: '', slots: [], error: '' })
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [success, setSuccess] = useState('')
  const [form, setForm] = useState({ date: tomorrowInKolkata(), startTime: '', servicePincode: '', serviceAddress: '', notes: '' })
  const loading = loadResult.serviceId !== serviceId
  const error = loading ? '' : loadResult.error

  useEffect(() => {
    let active = true
    Promise.all([api.get(`/services/${serviceId}`), api.get(`/reviews/service/${serviceId}`).catch(() => null)])
      .then(async ([serviceData, reviewsData]) => {
        if (!active) return
        const parsed = serviceData?.service || serviceData
        setService(parsed)
        setReviews(reviewsData ? asList(reviewsData) : [])
        const providerRef = parsed?.provider || parsed?.providerProfile || parsed?.providerId
        const providerKey = typeof providerRef === 'object' ? idOf(providerRef) : providerRef
        if (providerRef && typeof providerRef === 'object') setProvider(providerRef)
        else if (providerKey) {
          try {
            const profileData = await api.get(`/providers/${providerKey}`)
            if (active) setProvider(profileData?.provider || profileData)
          } catch {
            if (active) setProvider(null)
          }
        }
        if (!active) return
        const pincode = parsed?.servicePincode || parsed?.pincode || parsed?.servicePincodes?.[0] || parsed?.serviceArea?.pincode || ''
        setForm((current) => ({ ...current, servicePincode: String(pincode || '').slice(0, 6) }))
        setLoadResult({ serviceId, error: '' })
      })
      .catch((requestError) => { if (active) setLoadResult({ serviceId, error: errorMessage(requestError, 'We could not load this service.') }) })
    return () => { active = false }
  }, [serviceId])

  const providerRef = service?.provider || service?.providerProfile || service?.providerId
  const providerId = idOf(provider) || idOf(providerRef) || (typeof providerRef === 'string' ? providerRef : '')
  const validAvailabilityQuery = Boolean(providerId && /^\d{6}$/.test(form.servicePincode) && form.date)
  const availabilityKey = validAvailabilityQuery ? `${providerId}:${form.date}:${form.servicePincode}` : ''
  const availability = availabilityResult.key === availabilityKey ? availabilityResult.slots : []
  const availabilityLoading = validAvailabilityQuery && availabilityResult.key !== availabilityKey
  const availabilityError = availabilityResult.key === availabilityKey ? availabilityResult.error : ''

  useEffect(() => {
    if (!validAvailabilityQuery) return
    let active = true
    api.get(`/availability/${encodeURIComponent(providerId)}?date=${encodeURIComponent(form.date)}&pincode=${encodeURIComponent(form.servicePincode)}`)
      .then((data) => {
        if (!active) return
        const slots = (data?.availability?.slots || data?.slots || asList(data)).filter((slot) =>
          slot?.available !== false && slotStartTimestamp(slot, form.date) > Date.now(),
        )
        setAvailabilityResult({ key: availabilityKey, slots, error: '' })
      })
      .catch((requestError) => { if (active) setAvailabilityResult({ key: availabilityKey, slots: [], error: errorMessage(requestError) }) })
    return () => { active = false }
  }, [providerId, form.date, form.servicePincode, validAvailabilityQuery, availabilityKey])

  const price = useMemo(() => formatMoney(service?.price ?? service?.basePrice), [service])
  const providerName = provider?.user?.name || provider?.name || provider?.fullName || provider?.businessName || service?.providerName || 'Nearby service professional'
  const verification = String(provider?.verificationStatus || provider?.status || '').toLowerCase()
  const verified = provider?.verified === true || verification === 'verified' || verification === 'approved'
  const unavailable = provider?.verified === false || verification === 'pending' || verification === 'rejected'
  const selectedSlot = availability.find((slot) => (slot.startTime || slot.startsAt || slot.start || slot.time) === form.startTime)

  async function requestBooking(event) {
    event.preventDefault()
    setFormError('')
    setSuccess('')
    if (!user) { navigate('/login', { state: { from: `/services/${serviceId}` } }); return }
    if (getRole(user) !== 'customer') { setFormError('Only customer accounts can request a service booking.'); return }
    if (!/^\d{6}$/.test(form.servicePincode)) { setFormError('Enter the 6-digit PIN code where the service is needed.'); return }
    if (!selectedSlot) { setFormError('Choose an available time window before sending a booking request.'); return }
    setSubmitting(true)
    try {
      await api.post('/bookings', {
        serviceId: idOf(service) || serviceId,
        scheduledAt: new Date(`${form.date}T${form.startTime}:00+05:30`).toISOString(),
        servicePincode: form.servicePincode,
        serviceAddress: form.serviceAddress.trim(),
        notes: form.notes.trim(),
      })
      setSuccess('Request sent. You can follow its status from your bookings.')
    } catch (requestError) {
      setFormError(errorMessage(requestError, 'Your booking request could not be sent.'))
    } finally {
      setSubmitting(false)
    }
  }

  return <div className="public-page"><SiteHeader compact /><main className="detail-main section-wrap">
    <div className="breadcrumbs"><Link to="/">Home</Link><span>/</span><Link to="/services">Services</Link><span>/</span><span>{loading ? 'Loading' : service?.title || service?.name || 'Details'}</span></div>
    {loading ? <LoadingState label="Loading service details…" /> : error ? <ErrorState message={error} onRetry={() => window.location.reload()} /> : service ? <>
      <Link to="/services" className="back-link"><ArrowLeft size={16} /> All services</Link>
      <div className="detail-layout">
        <article className="service-detail-content">
          <div className="detail-art"><span className="detail-art-label">{service.category || 'LOCAL SERVICE'}</span><span className="detail-art-symbol">✳</span><div className="detail-art-copy"><span>NEARBY SERVICE NO. {String(serviceId).slice(-4).toUpperCase()}</span><h1>{service.title || service.name || service.serviceName || 'Service details'}</h1></div><span className="detail-art-circle" /></div>
          <div className="detail-overview"><div className="detail-title-row"><div><span className="eyebrow">THE SERVICE</span><h2>{service.title || service.name || service.serviceName || 'Service details'}</h2></div><strong className="detail-price">{price}<small>{service.priceUnit ? ` / ${service.priceUnit}` : ''}</small></strong></div>
            <p className="detail-description">{service.description || 'Contact this professional with the details of the work you have in mind. You can discuss the scope before confirming.'}</p>
            <div className="detail-facts"><div><DetailIcon><MapPin size={17} /></DetailIcon><span><b>Local coverage</b><small>{service.servicePincode || service.pincode || provider?.servicePincodes?.join(', ') || 'Enter your PIN code when requesting'}</small></span></div><div><DetailIcon><Clock3 size={17} /></DetailIcon><span><b>Scheduling</b><small>Request a time that suits you</small></span></div><div><DetailIcon><ShieldCheck size={17} /></DetailIcon><span><b>Provider verification</b><small>{verified ? 'Verified by Nearby' : unavailable ? 'Verification pending' : 'Status is confirmed by the provider profile'}</small></span></div></div>
          </div>
          <section className="provider-card"><div className="provider-avatar">{providerName.slice(0, 1).toUpperCase()}</div><div className="provider-info"><span className="eyebrow">YOUR LOCAL PROFESSIONAL</span><h3>{providerName} {verified && <BadgeCheck size={18} className="verified-icon" />}</h3><p>{provider?.bio || provider?.description || 'A service professional offering help through Nearby.'}</p>{provider?.city && <span className="provider-location"><MapPin size={14} /> {provider.city}</span>}</div><div className="provider-rating">{service.rating ? <><Star size={15} fill="currentColor" /> {Number(service.rating).toFixed(1)}</> : <span>Nearby profile</span>}</div></section>
          {reviews.length > 0 && <section className="reviews-section"><span className="eyebrow">CUSTOMER NOTES</span><h2>Reviews</h2><div className="review-list">{reviews.slice(0, 4).map((review, index) => <article className="review-card" key={review._id || review.id || index}><div className="review-stars">{'★'.repeat(Math.max(0, Math.min(5, Number(review.rating || 0))))}</div><p>{review.comment || review.text || 'Completed service'}</p><small>{review.customer?.name || review.customerName || 'Nearby customer'}</small></article>)}</div></section>}
        </article>
        <aside className="booking-panel"><div className="booking-panel-head"><span className="eyebrow">LET'S GET IT SORTED</span><h2>Request a booking</h2><p>Send a request first. Payment is available only after the provider accepts.</p></div>
          {success ? <div className="booking-success"><span><CheckCircle2 size={25} /></span><h3>Request sent</h3><p>{success}</p><Link className="button button-primary" to="/dashboard">View my bookings <ArrowRight size={16} /></Link></div> : <form className="booking-form" onSubmit={requestBooking}>
            {formError && <div className="notice notice-error" role="alert">{formError}</div>}
            <label className="field"><span><CalendarDays size={15} /> Preferred date</span><input type="date" min={kolkataDate(new Date())} required value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value, startTime: '' })} /></label>
            <label className="field"><span><MapPin size={15} /> Service PIN code</span><input required inputMode="numeric" maxLength={6} placeholder="6-digit PIN code" value={form.servicePincode} onChange={(event) => setForm({ ...form, servicePincode: event.target.value.replace(/\D/g, '').slice(0, 6), startTime: '' })} /></label>
            <label className="field"><span><Clock3 size={15} /> Available time</span><select required disabled={availabilityLoading || !availability.length} value={form.startTime} onChange={(event) => setForm({ ...form, startTime: event.target.value })}><option value="">{availabilityLoading ? 'Checking available times…' : availability.length ? 'Choose a time window' : 'No available times for this date'}</option>{availability.map((slot, index) => { const start = slot.startTime || slot.startsAt || slot.start || slot.time || ''; const end = slot.endTime || slot.endsAt || slot.end || ''; return <option key={slot._id || `${start}-${index}`} value={start}>{start}{end ? ` – ${end}` : ''} IST</option> })}</select>{availabilityError && <small className="field-help">{availabilityError}</small>}{!availabilityError && !availabilityLoading && availability.length > 0 && !selectedSlot && <small className="field-help">Choose a currently available time window to enable your request.</small>}{!availabilityError && !availabilityLoading && !providerId && <small className="field-help">Provider availability is not available for this service yet.</small>}{!availabilityError && !availabilityLoading && providerId && /^\d{6}$/.test(form.servicePincode) && !availability.length && <small className="field-help">Try another date or PIN code, or check back with the provider.</small>}</label>
            <label className="field"><span>Service address</span><textarea required minLength={8} rows={3} maxLength={300} placeholder="House / flat, street, area" value={form.serviceAddress} onChange={(event) => setForm({ ...form, serviceAddress: event.target.value })} /></label>
            <label className="field"><span>Anything the pro should know? <small>Optional</small></span><textarea rows={3} maxLength={500} placeholder="Share a few details about the job" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
            <button className="button button-primary booking-submit" type="submit" disabled={submitting || availabilityLoading || !selectedSlot}>{submitting ? <span className="spinner" /> : <>Send booking request <ArrowRight size={17} /></>}</button>
            <p className="booking-footnote"><ShieldCheck size={14} /> No payment is taken at this step.</p>
          </form>}
          <div className="booking-help"><MessageSquare size={17} /><span><b>Need to ask a question?</b><small>Chat opens after a booking is accepted.</small></span></div>
        </aside>
      </div>
    </> : <ErrorState message="This service is not available." onRetry={() => navigate('/services')} />}
  </main><Footer /></div>
}
