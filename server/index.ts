import { pathToFileURL } from 'node:url';
import app from './src/app.js';
import { allowedEmails, port } from './src/config/env.js';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  app.listen(port, () => {
    if (allowedEmails.length === 0) {
      console.warn('ALLOWED_EMAILS is not configured. Any authenticated user can use the app.');
    }
    console.log(`ResumeX server listening on http://localhost:${port}`);
  });
}

export default app;
