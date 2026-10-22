import { useEffect, useState } from 'react'
import { ArrowRight, BookOpen, Brush, CheckCircle2, ChevronRight, Hammer, MapPin, Search, ShieldCheck, Sparkles, Wrench, Zap } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ErrorState, Footer, LoadingState, ServiceCard, SiteHeader } from '../components/AppChrome.jsx'
import { api, asList, errorMessage } from '../services/api.js'
import heroImage from '../assets/nearby-landing-hero.webp'

const categories = [
  { name: 'Home repairs', icon: Hammer, tint: 'peach' },
  { name: 'Plumbing', icon: Wrench, tint: 'blue' },
  { name: 'Electrical', icon: Zap, tint: 'yellow' },
  { name: 'Cleaning', icon: Sparkles, tint: 'green' },
  { name: 'Painting', icon: Brush, tint: 'lavender' },
  { name: 'Tutoring', icon: BookOpen, tint: 'pink' },
]

function queryFor(params) {
  return new URLSearchParams([...params.entries()].filter(([, value]) => value.trim()))
}

function SearchBox({ initialQuery = '', initialPincode = '', initialCategory = '' }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState(initialQuery)
  const [pincode, setPincode] = useState(initialPincode)
  const [error, setError] = useState('')

  function submit(event) {
    event.preventDefault()
    if (pincode && !/^\d{6}$/.test(pincode)) {
      setError('Enter a valid 6-digit Indian PIN code to see services in your area.')
      return
    }
    setError('')
    const params = new URLSearchParams()
    if (query.trim()) params.set('q', query.trim())
    if (pincode.trim()) params.set('pincode', pincode.trim())
    if (initialCategory) params.set('category', initialCategory)
    navigate(`/services${params.size ? `?${params.toString()}` : ''}`)
  }

  return <form className="hero-search" onSubmit={submit}>
    <label className="search-input search-service"><Search size={19} /><span className="sr-only">Service or skill</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="What do you need help with?" /></label>
    <span className="search-divider" />
    <label className="search-input search-place"><MapPin size={19} /><span className="sr-only">PIN code</span><input value={pincode} onChange={(event) => setPincode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" maxLength={6} placeholder="Enter PIN code" /></label>
    <button className="button button-primary search-button" type="submit"><span>Find help</span><ArrowRight size={17} /></button>
    {error && <p className="search-error" role="alert">{error}</p>}
  </form>
}

export function Home() {
  const [services, setServices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    api.get('/services')
      .then((data) => { if (active) { setServices(asList(data).slice(0, 3)); setError('') } })
      .catch((requestError) => { if (active) setError(errorMessage(requestError)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [attempt])

  return <div className="public-page home-page">
    <SiteHeader />
    <main className="home-main">
      <section className="home-hero" aria-labelledby="home-hero-title">
        <div className="home-hero-copy">
          <p className="home-kicker"><span className="home-kicker-dot" aria-hidden="true" /> LOCAL SERVICES, JUST AROUND THE CORNER</p>
          <h1 id="home-hero-title">Good help for home.<br /><em>Right around here.</em></h1>
          <p className="home-hero-lede">Find local services for the fixes, refreshes, and everyday jobs on your list.</p>
          <SearchBox />
          <div className="home-hero-points"><span><MapPin size={15} /> Search by 6-digit PIN</span><span><CheckCircle2 size={15} /> Review details before booking</span></div>
        </div>
        <figure className="home-hero-visual">
          <span className="home-hero-backdrop" aria-hidden="true" />
          <div className="home-hero-image-wrap">
            <img src={heroImage} alt="A cobalt toolbox and home repair tools arranged beneath a yellow arch." />
            <span className="home-hero-image-label">GOOD WORK · CLOSE TO HOME</span>
          </div>
          <figcaption><span>TOOLS FOR THE EVERYDAY</span><span>01 / NEARBY</span></figcaption>
        </figure>
      </section>

      <section className="home-discovery section-wrap" aria-labelledby="home-discovery-title">
        <div className="home-section-heading">
          <div><p className="home-section-index"><span>01</span> BROWSE BY SERVICE</p><h2 id="home-discovery-title">What needs doing?</h2></div>
          <div className="home-section-aside"><p>Pick a skill, then use your PIN code to see service listings in your area.</p><Link className="home-text-link" to="/services">Explore all services <ArrowRight size={16} /></Link></div>
        </div>
        <div className="home-category-grid">{categories.map(({ name, icon: Icon, tint }) => <Link key={name} className={`home-category-card home-category-card--${tint}`} to={`/services?category=${encodeURIComponent(name)}`}><span className="home-category-card-top"><span className={`home-category-icon ${tint}`}><Icon size={22} /></span><ChevronRight size={18} /></span><strong>{name}</strong><span className="home-category-hint">Explore local listings</span></Link>)}</div>
      </section>

      <section className="home-featured section-wrap" aria-labelledby="home-featured-title">
        <div className="home-section-heading home-featured-heading">
          <div><p className="home-section-index"><span>02</span> GOOD WORK CLOSE TO HOME</p><h2 id="home-featured-title">Services around you.</h2><p className="home-section-description">Explore offerings from local professionals on Nearby.</p></div>
          <Link className="home-text-link" to="/services">View the directory <ArrowRight size={16} /></Link>
        </div>
        {loading ? <div className="home-featured-state"><LoadingState label="Finding local services…" /></div> : error ? <div className="home-featured-state"><ErrorState message={error} onRetry={() => { setLoading(true); setAttempt((n) => n + 1) }} /></div> : services.length ? <div className="service-grid home-service-grid">{services.map((service) => <ServiceCard key={service._id || service.id} service={service} />)}</div> : <div className="home-empty-state"><span className="home-empty-mark" aria-hidden="true">✳</span><div><h3>No services are listed yet.</h3><p>Explore the directory or check back soon.</p></div><Link className="home-text-link" to="/services">Explore services <ArrowRight size={15} /></Link></div>}
      </section>

      <section className="home-how" aria-labelledby="home-how-title">
        <div className="section-wrap home-how-layout">
          <div className="home-how-intro"><p className="home-section-index"><span>03</span> HOW NEARBY WORKS</p><h2 id="home-how-title">Three steps.<br /><em>One thing off your list.</em></h2><p>Search, compare service details, and send a booking request that works for you.</p><Link to="/services" className="button button-primary">Browse services <ArrowRight size={16} /></Link></div>
          <div className="home-how-steps"><article><span className="home-step-number">01</span><div><h3>Tell us what you need</h3><p>Search by service and your 6-digit PIN code to see what is listed nearby.</p></div></article><article><span className="home-step-number">02</span><div><h3>Choose a local pro</h3><p>Compare service details and request a time that works for you.</p></div></article><article><span className="home-step-number">03</span><div><h3>Get it done, together</h3><p>Stay in touch through your booking and share a review when the job is complete.</p></div></article></div>
        </div>
      </section>

      <section className="home-provider-cta section-wrap" aria-labelledby="home-provider-title"><div><p className="home-section-index"><span>04</span> FOR LOCAL PROFESSIONALS</p><h2 id="home-provider-title">Bring your skills<br /><em>closer to home.</em></h2><p>List your services and meet customers in your area.</p></div><Link to="/signup" className="button button-primary">Offer your services <ArrowRight size={17} /></Link><span className="home-provider-spark" aria-hidden="true">✳</span></section>
    </main>
    <Footer />
  </div>
}

export function ServicesPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  return <ServicesListing key={searchParams.toString()} searchParams={searchParams} setSearchParams={setSearchParams} />
}

function ServicesListing({ searchParams, setSearchParams }) {
  const [query, setQuery] = useState(searchParams.get('q') || '')
  const [pincode, setPincode] = useState(searchParams.get('pincode') || '')
  const [category, setCategory] = useState(searchParams.get('category') || '')
  const [services, setServices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [formError, setFormError] = useState('')

  const serialized = searchParams.toString()
  useEffect(() => {
    let active = true
    const params = new URLSearchParams(serialized)
    api.get(`/services${params.size ? `?${params.toString()}` : ''}`)
      .then((data) => { if (active) { setServices(asList(data)); setError('') } })
      .catch((requestError) => { if (active) setError(errorMessage(requestError)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [serialized, attempt])

  function submit(event) {
    event.preventDefault()
    if (pincode && !/^\d{6}$/.test(pincode)) { setFormError('Enter a valid 6-digit PIN code.'); return }
    setFormError('')
    const next = new URLSearchParams()
    if (query.trim()) next.set('q', query.trim())
    if (pincode) next.set('pincode', pincode)
    if (category) next.set('category', category)
    setSearchParams(queryFor(next))
  }

  return <div className="public-page"><SiteHeader compact /><main className="listing-main section-wrap">
    <div className="breadcrumbs"><Link to="/">Home</Link><ChevronRight size={14} /><span>Services</span></div>
    <div className="listing-heading"><span className="eyebrow">LOCAL SKILLS, MADE EASY TO FIND</span><h1>Find your kind of <em>help.</em></h1><p>Search local service listings by skill and exact PIN code.</p></div>
    <form className="listing-search" onSubmit={submit}><label className="listing-query"><Search size={18} /><span className="sr-only">Search services</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Try “leaky tap” or “math tutor”" /></label><label className="listing-pin"><MapPin size={18} /><span className="sr-only">PIN code</span><input value={pincode} onChange={(event) => setPincode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" maxLength={6} placeholder="6-digit PIN code" /></label><button className="button button-primary" type="submit">Search <ArrowRight size={16} /></button></form>
    {formError && <p className="form-error" role="alert">{formError}</p>}
    <div className="filter-row"><span className="filter-label">Browse a category</span><button type="button" className={!category ? 'filter-chip active' : 'filter-chip'} onClick={() => { setCategory(''); setSearchParams(queryFor(new URLSearchParams([...searchParams.entries()].filter(([key]) => key !== 'category')))) }}>All services</button>{categories.map((item) => <button type="button" key={item.name} className={category === item.name ? 'filter-chip active' : 'filter-chip'} onClick={() => { const next = new URLSearchParams(searchParams); category === item.name ? next.delete('category') : next.set('category', item.name); setSearchParams(next) }}>{item.name}</button>)}</div>
    <div className="results-heading"><div><span className="eyebrow">{pincode ? `PIN CODE ${pincode}` : 'NEARBY DIRECTORY'}</span><h2>{category || 'All services'} <span>{!loading && !error ? `(${services.length})` : ''}</span></h2></div><span className="results-note"><ShieldCheck size={15} /> Only listings returned by Nearby</span></div>
    {loading ? <LoadingState label="Looking for local pros…" /> : error ? <ErrorState message={error} onRetry={() => { setLoading(true); setAttempt((n) => n + 1) }} /> : services.length ? <div className="service-grid service-grid-results">{services.map((service) => <ServiceCard key={service._id || service.id} service={service} />)}</div> : <div className="results-empty"><div className="empty-illustration"><Search size={25} /></div><h3>{pincode ? 'No listings found for this PIN code yet' : 'No services match those filters'}</h3><p>Try a different skill or PIN code. We only show service listings returned by Nearby.</p><button className="button button-outline" onClick={() => { setQuery(''); setPincode(''); setCategory(''); setSearchParams({}) }}>Clear filters</button></div>}
  </main><Footer /></div>
}
