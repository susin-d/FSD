import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { LoadingState } from './components/AppChrome.jsx'
import Dashboard from './pages/Dashboard.jsx'
import { Home, ServicesPage } from './pages/Home.jsx'
import Login from './pages/auth/Login.jsx'
import Signup from './pages/auth/Signup.jsx'
import ServiceDetail from './pages/ServiceDetail.jsx'
import { SessionProvider } from './services/Session.jsx'
import { useSession } from './services/useSession.js'
import { getRole } from './services/roles.js'
import './App.css'

function homeForRole(user) {
  const role = getRole(user)
  return role === 'admin' ? '/admin' : role === 'provider' ? '/provider' : '/dashboard'
}

function ProtectedPage({ children, role }) {
  const { user, ready } = useSession()
  const location = useLocation()
  if (!ready) return <LoadingState full label="Getting Nearby ready…" />
  if (!user) return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
  if (role && getRole(user) !== role) return <Navigate to={homeForRole(user)} replace />
  return children
}

function AppRoutes() {
  const { ready } = useSession()
  if (!ready) return <LoadingState full label="Getting Nearby ready…" />
  return <Routes>
    <Route path="/" element={<Home />} />
    <Route path="/services" element={<ServicesPage />} />
    <Route path="/services/:serviceId" element={<ServiceDetail />} />
    <Route path="/login" element={<Login />} />
    <Route path="/signup" element={<Signup />} />
    <Route path="/dashboard" element={<ProtectedPage><Dashboard /></ProtectedPage>} />
    <Route path="/provider" element={<ProtectedPage role="provider"><Dashboard /></ProtectedPage>} />
    <Route path="/admin" element={<ProtectedPage role="admin"><Dashboard /></ProtectedPage>} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
}

export default function App() {
  return <BrowserRouter><SessionProvider><AppRoutes /></SessionProvider></BrowserRouter>
}
