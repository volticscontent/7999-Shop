import { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2022-11-15' as any, // fallback for typescript compilation, though Stripe Node SDK 19.x uses string literals
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { session_id } = req.query;

  if (!session_id || typeof session_id !== 'string') {
    return res.status(400).json({ error: 'Session ID is required' });
  }

  try {
    // Buscar detalhes da sessão do Stripe
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['line_items', 'customer', 'payment_intent']
    });

    // Buscar line items com mais detalhes
    const lineItems = await stripe.checkout.sessions.listLineItems(session_id, {
      expand: ['data.price.product']
    });

    // Estruturar dados para envio ao Shopify
    const orderData = {
      stripe_session_id: session.id,
      status: session.status,
      payment_status: session.payment_status,
      amount_total: session.amount_total,
      currency: session.currency,
      customer: {
        name: session.customer_details?.name || '',
        email: session.customer_details?.email || '',
        phone: session.customer_details?.phone || null,
        address: session.customer_details?.address || null,
      },
      line_items: lineItems.data.map(item => ({
        price_id: item.price?.id,
        product_id: typeof item.price?.product === 'object' ? item.price.product.id : item.price?.product,
        product_name: typeof item.price?.product === 'object' && 'name' in item.price.product ? item.price.product.name : 'Unknown Product',
        quantity: item.quantity,
        amount_total: item.amount_total,
      })),
      metadata: session.metadata || {},
      utm_params: {
        utm_source: session.metadata?.utm_source || null,
        utm_medium: session.metadata?.utm_medium || null,
        utm_campaign: session.metadata?.utm_campaign || null,
        utm_content: session.metadata?.utm_content || null,
        utm_term: session.metadata?.utm_term || null,
      },
      created: session.created,
      payment_intent_id: typeof session.payment_intent === 'object'
        ? session.payment_intent?.id
        : session.payment_intent,
    };

    // Simular o Webhook do Stripe para o Backend Local (CRM)
    // Isso é necessário porque o Stripe não envia webhooks para o localhost
    try {
      await fetch('http://localhost:3000/api/webhooks/stripe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'checkout.session.completed',
          data: { object: session }
        })
      });
      console.log('✅ Evento de checkout enviado para o CRM Backend local (localhost:3000)');
    } catch (e: any) {
      console.warn('⚠️ Não foi possível sincronizar com o CRM (backend-leads) na porta 3000:', e.message);
    }

    console.log('📊 Dados da sessão Stripe recuperados:', {
      session_id: session.id,
      amount: session.amount_total,
      currency: session.currency,
      customer_email: session.customer_details?.email,
      utm_params: orderData.utm_params
    });

    return res.status(200).json({
      success: true,
      data: orderData
    });

  } catch (error: any) {
    console.error('❌ Erro ao buscar sessão do Stripe:', error);
    return res.status(500).json({
      error: 'Failed to retrieve session details',
      message: error.message
    });
  }
}