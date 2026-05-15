'use strict';
const Stripe = require('stripe');
const { getDb } = require('../db/database');
const { authMiddleware, loadUser } = require('../middleware/auth');

const TIER_MAP = {
  [process.env.STRIPE_PRICE_BASICS]:  'basics',
  [process.env.STRIPE_PRICE_ELITE]:   'elite',
  [process.env.STRIPE_PRICE_GODMODE]: 'godmode',
};

async function stripeRoutes(fastify) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });

  // POST /api/stripe/checkout — create Stripe Checkout session
  fastify.post('/checkout', {
    preHandler: [authMiddleware, loadUser],
    schema: {
      body: {
        type: 'object',
        required: ['priceId'],
        properties: { priceId: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const user = request.dbUser;
    const { priceId } = request.body;

    const validPrices = [
      process.env.STRIPE_PRICE_BASICS,
      process.env.STRIPE_PRICE_ELITE,
      process.env.STRIPE_PRICE_GODMODE,
    ];

    if (!validPrices.includes(priceId)) {
      return reply.code(400).send({ error: 'Invalid price ID' });
    }

    let customerId = user.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.username,
        metadata: { userId: String(user.id) },
      });
      customerId = customer.id;
      getDb().prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?')
        .run(customerId, user.id);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.APP_URL}/app?upgrade=success`,
      cancel_url:  `${process.env.APP_URL}/pricing`,
      subscription_data: {
        metadata: { userId: String(user.id) },
      },
    });

    return { url: session.url };
  });

  // POST /api/stripe/portal — billing portal for cancellation/upgrade
  fastify.post('/portal', { preHandler: [authMiddleware, loadUser] }, async (request, reply) => {
    const user = request.dbUser;
    if (!user.stripe_customer_id) {
      return reply.code(400).send({ error: 'No billing account found' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: `${process.env.APP_URL}/app`,
    });

    return { url: session.url };
  });

  // POST /api/stripe/webhook — handle Stripe events
  fastify.post('/webhook', {
    config: { rawBody: true }, // needed for signature verification
  }, async (request, reply) => {
    const sig = request.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        request.rawBody,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      return reply.code(400).send({ error: `Webhook Error: ${err.message}` });
    }

    const db = getDb();

    // Idempotency check
    const exists = db.prepare('SELECT id FROM stripe_events WHERE event_id = ?').get(event.id);
    if (exists) return { received: true };

    db.prepare('INSERT INTO stripe_events (event_id, type) VALUES (?, ?)').run(event.id, event.type);

    const handleSubscription = (subscription, status) => {
      const userId = subscription.metadata?.userId;
      if (!userId) return;

      const priceId = subscription.items?.data?.[0]?.price?.id;
      const tier = TIER_MAP[priceId] || 'free';

      db.prepare(`
        UPDATE users SET
          tier = ?,
          subscription_status = ?,
          stripe_subscription_id = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(status === 'active' ? tier : 'free', status, subscription.id, parseInt(userId));
    };

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        handleSubscription(event.data.object, event.data.object.status);
        break;

      case 'customer.subscription.deleted':
        handleSubscription(event.data.object, 'cancelled');
        break;

      case 'invoice.payment_failed':
        const sub = event.data.object.subscription;
        if (sub) {
          const userId = event.data.object.subscription_details?.metadata?.userId;
          if (userId) {
            db.prepare(`UPDATE users SET subscription_status = 'past_due' WHERE id = ?`)
              .run(parseInt(userId));
          }
        }
        break;
    }

    db.prepare('UPDATE stripe_events SET processed = 1 WHERE event_id = ?').run(event.id);
    return { received: true };
  });
}

module.exports = stripeRoutes;
