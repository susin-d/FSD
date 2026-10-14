import { useEffect, useState } from 'react'
import { ArrowRight, BadgeCheck, BookOpen, Brush, CheckCircle2, ChevronRight, Clock3, Hammer, MapPin, Search, ShieldCheck, Sparkles, Wrench, Zap } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ErrorState, Footer, LoadingState, ServiceCard, SiteHeader } from '../components/AppChrome.jsx'
import { api, asList, errorMessage } from '../services/api.js'

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

  return <div className="public-page">
    <SiteHeader />
    <main>
      <section className="hero-section">
        <div className="hero-copy">
          <span className="eyebrow"><span className="eyebrow-dot" /> GOOD PEOPLE, JUST AROUND THE CORNER</span>
          <h1>It takes a <em>neighbor</em><br />to make a home.</h1>
          <p>From the quick fix to the big to-do, find a skilled local pro who makes getting it done feel easy.</p>
          <SearchBox />
          <div className="hero-assurance"><span><ShieldCheck size={16} /> Profiles reviewed by Nearby</span><span><CheckCircle2 size={16} /> Book with clarity</span></div>
        </div>
        <div className="hero-art" aria-label="Nearby local services illustration">
          <div className="hero-art-paper"><div className="sun-shape" /><div className="house-roof" /><div className="house-body"><div className="house-window" /><div className="house-door" /></div><div className="plant plant-left"><i /><i /><i /><b /></div><div className="plant plant-right"><i /><i /><i /><b /></div></div>
          <div className="floating-note note-top"><span className="note-icon note-yellow"><Clock3 size={17} /></span><span><b>Help that fits your day</b><small>Local, flexible, reliable</small></span></div>
          <div className="floating-note note-bottom"><span className="note-icon note-blue"><BadgeCheck size={18} /></span><span><b>Good hands, nearby</b><small>Reviewed provider profiles</small></span></div>
          <span className="hero-asterisk" aria-hidden="true">✳</span><span className="hero-stamp">YOUR<br />NEIGHBORHOOD<br />HELP DESK</span>
        </div>
        <div className="hero-index"><span>01</span><i /> <span>04</span></div>
      </section>

      <section className="category-section section-wrap">
        <div className="section-heading"><div><span className="eyebrow">A GOOD PLACE TO START</span><h2>What can we help with?</h2></div><Link to="/services" className="text-link">Explore all services <ArrowRight size={16} /></Link></div>
        <div className="category-grid">{categories.map(({ name, icon: Icon, tint }) => <Link key={name} className="category-tile" to={`/services?category=${encodeURIComponent(name)}`}><span className={`category-icon ${tint}`}><Icon size={22} /></span><span>{name}</span><ChevronRight size={15} className="category-chevron" /></Link>)}</div>
      </section>

      <section className="featured-section section-wrap">
        <div className="section-heading"><div><span className="eyebrow">GOOD WORK CLOSE TO HOME</span><h2>Services around you</h2><p>Explore offerings from local professionals on Nearby.</p></div><Link to="/services" className="text-link">See all <ArrowRight size={16} /></Link></div>
        {loading ? <LoadingState label="Finding local services…" /> : error ? <ErrorState message={error} onRetry={() => { setLoading(true); setAttempt((n) => n + 1) }} /> : services.length ? <div className="service-grid">{services.map((service) => <ServiceCard key={service._id || service.id} service={service} />)}</div> : <div className="inline-empty"><span className="inline-empty-star">✳</span><span>New services are on their way. Search your PIN code or check back soon.</span><Link to="/services">Explore Nearby <ArrowRight size={15} /></Link></div>}
      </section>

      <section className="how-section">
        <div className="section-wrap how-layout"><div className="how-intro"><span className="eyebrow">NEARBY MAKES IT SIMPLE</span><h2>Small tasks.<br /><em>Good neighbors.</em></h2><p>Get the details you need, choose a time, and let a nearby pro take it from there.</p><Link to="/services" className="button button-dark">Browse services <ArrowRight size={16} /></Link></div><div className="how-steps"><article><span className="step-no">01</span><div><h3>Tell us what you need</h3><p>Search by service and your 6-digit PIN code to see what's available nearby.</p></div></article><article><span className="step-no">02</span><div><h3>Choose a local pro</h3><p>Compare clear service details and send a booking request that works for you.</p></div></article><article><span className="step-no">03</span><div><h3>Get it done, together</h3><p>Stay in touch through your booking and share a review when the job is complete.</p></div></article></div></div>
      </section>

      <section className="join-banner section-wrap"><div><span className="eyebrow">SKILLED AT WHAT YOU DO?</span><h2>Bring your work <em>closer.</em></h2><p>Meet customers in your area and grow your independent service business.</p></div><Link to="/signup" className="button button-primary">Offer your services <ArrowRight size={17} /></Link><span className="join-sparkle" aria-hidden="true">✳</span></section>
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
