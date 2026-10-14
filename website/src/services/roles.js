export function getRole(user) {
  return String(user?.role || user?.accountType || 'customer').toLowerCase()
}

export function destinationFor(user) {
  const role = getRole(user)
  return role === 'admin' ? '/admin' : role === 'provider' ? '/provider' : '/dashboard'
}
