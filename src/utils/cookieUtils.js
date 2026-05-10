/**
 * Sweep cookies across multiple paths to ensure thorough removal
 */
exports.sweepCookies = (res, name) => {
  const options = {
    httpOnly: name.toLowerCase().includes('refresh'),
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  };

  // Clear from root (most common)
  res.clearCookie(name, { ...options, path: '/' });
  
  // Clear from legacy auth path (known production issue)
  res.clearCookie(name, { ...options, path: '/api/v1/auth' });
};

/**
 * Get first non-empty value from a potential cookie array
 */
exports.getFirstNonEmpty = (val) => {
  if (Array.isArray(val)) return val.find(v => typeof v === 'string' && v.trim().length > 0) || null;
  if (typeof val === 'string' && val.trim().length > 0) return val;
  return null;
};
