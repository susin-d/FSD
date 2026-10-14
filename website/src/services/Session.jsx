import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, setToken } from './api.js'
import { SessionContext } from './session-context.js'

function userFrom(value) {
  return value?.user || value?.account || value?.profile || value || null
}

function authFrom(value) {
  const data = value?.data || value
  return {
    token: data?.token || data?.accessToken || data?.auth?.token,
    user: userFrom(data),
  }
}

export function SessionProvider({ children }) {
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(() => !window.sessionStorage.getItem('nearby.token'))

  const refreshUser = useCallback(async () => {
    const data = await api.get('/auth/me')
    const next = userFrom(data)
    setUser(next)
    return next
  }, [])

  useEffect(() => {
    let mounted = true
    if (!window.sessionStorage.getItem('nearby.token')) {
      return () => { mounted = false }
    }
    api.get('/auth/me')
      .then((data) => { if (mounted) setUser(userFrom(data)) })
      .catch(() => { if (mounted) { setToken(null); setUser(null) } })
      .finally(() => { if (mounted) setReady(true) })
    return () => { mounted = false }
  }, [])

  const establishSession = useCallback(async (result, credentials) => {
    let auth = authFrom(result)
    if (!auth.token && credentials) auth = authFrom(await api.post('/auth/login', credentials))
    if (!auth.token) throw new Error('The API did not return a sign-in token. Please try again or contact support.')
    setToken(auth.token)
    const nextUser = auth.user || await (async () => {
      const data = await api.get('/auth/me')
      return userFrom(data)
    })()
    setUser(nextUser)
    setReady(true)
    return nextUser
  }, [])

  const login = useCallback(async (credentials) => {
    const result = await api.post('/auth/login', credentials)
    return establishSession(result)
  }, [establishSession])

  const register = useCallback(async (details) => {
    const result = await api.post('/auth/register', details)
    return establishSession(result, { email: details.email, password: details.password })
  }, [establishSession])

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
  }, [])

  const value = useMemo(() => ({ user, ready, login, register, logout, refreshUser, setUser }), [user, ready, login, register, logout, refreshUser])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
