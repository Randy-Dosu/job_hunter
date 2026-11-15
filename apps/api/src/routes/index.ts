import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import { registerAuthRoutes } from './auth.js';
import { registerProfileRoutes } from './profile.js';
import { registerResumeRoutes } from './resumes.js';
import { registerPreferencesRoutes } from './preferences.js';
import { registerScanRoutes } from './scans.js';
import { registerJobRoutes } from './jobs.js';
import { registerDocumentRoutes } from './documents.js';
import { registerApplicationRoutes } from './applications.js';
import { registerBrowserRoutes } from './browser.js';
import { registerNotificationRoutes } from './notifications.js';
import { registerPrivacyRoutes } from './privacy.js';
import { registerDashboardRoutes } from './dashboard.js';

export async function registerRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  await app.register(registerAuthRoutes, context);
  await app.register(registerProfileRoutes, context);
  await app.register(registerResumeRoutes, context);
  await app.register(registerPreferencesRoutes, context);
  await app.register(registerScanRoutes, context);
  await app.register(registerJobRoutes, context);
  await app.register(registerDocumentRoutes, context);
  await app.register(registerApplicationRoutes, context);
  await app.register(registerBrowserRoutes, context);
  await app.register(registerNotificationRoutes, context);
  await app.register(registerPrivacyRoutes, context);
  await app.register(registerDashboardRoutes, context);
}
