/**
 * Simple server-side HTTP Basic Auth.
 * Browsers show a native login prompt - no frontend code needed.
 * Credentials come from environment variables, never hardcoded.
 */
function requireAuth(req, res, next) {
  const user = process.env.ADMIN_USERNAME;
  const pass = process.env.ADMIN_PASSWORD;

  // If credentials aren't configured, fail closed (block access) rather than
  // silently leaving the app open - better to notice this in setup than in prod.
  if (!user || !pass) {
    return res
      .status(500)
      .send('Server misconfigured: ADMIN_USERNAME / ADMIN_PASSWORD not set.');
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Devlok Kahaniyan"');
    return res.status(401).send('Authentication required.');
  }

  const base64Credentials = authHeader.split(' ')[1];
  const [reqUser, reqPass] = Buffer.from(base64Credentials, 'base64')
    .toString('utf-8')
    .split(':');

  if (reqUser === user && reqPass === pass) {
    return next();
  }

  res.set('WWW-Authenticate', 'Basic realm="Devlok Kahaniyan"');
  return res.status(401).send('Invalid credentials.');
}

module.exports = { requireAuth };
