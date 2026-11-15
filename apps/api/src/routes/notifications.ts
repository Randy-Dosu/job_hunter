import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import { errors } from '../lib/errors.js';
import { requireUser } from './guards.js';

export async function registerNotificationRoutes(
  app: FastifyInstance,
  context: AppContext,
): Promise<void> {
  const { db } = context;

  app.get('/notifications', async (request) => {
    const user = requireUser(request);
    const [items, unread] = await Promise.all([
      db.notification.findMany({
        where: { userId: user.userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      db.notification.count({ where: { userId: user.userId, readAt: null } }),
    ]);
    return {
      items: items.map((item) => ({
        id: item.id,
        kind: item.kind,
        title: item.title,
        body: item.body,
        link: item.link,
        readAt: item.readAt?.toISOString() ?? null,
        createdAt: item.createdAt.toISOString(),
      })),
      unread,
      enabled: context.env.FEATURE_NOTIFICATIONS,
    };
  });

  app.post<{ Params: { id: string } }>('/notifications/:id/read', async (request) => {
    const user = requireUser(request);
    const updated = await db.notification.updateMany({
      where: { id: request.params.id, userId: user.userId },
      data: { readAt: new Date() },
    });
    if (updated.count === 0) throw errors.notFound('Notification not found');
    return { ok: true };
  });

  app.post('/notifications/read-all', async (request) => {
    const user = requireUser(request);
    const updated = await db.notification.updateMany({
      where: { userId: user.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: updated.count };
  });

  app.delete('/notifications', async (request, reply) => {
    const user = requireUser(request);
    await db.notification.deleteMany({ where: { userId: user.userId } });
    return reply.status(204).send();
  });
}
