import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSubscriptionForUser } from '@/lib/supabase/subscriptions';
import { createPortalSession } from '@/lib/billing/provider';

/**
 * POST /api/stripe/portal (change-A).
 *
 * Authorizes inside the handler. Returns a Customer Portal URL for self-service
 * management / cancellation. Users without a billing profile get a clear 400
 * rather than an unhandled error.
 */
export async function POST(): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const subscription = await getSubscriptionForUser(user.id, supabase);
  if (!subscription?.stripeCustomerId) {
    return NextResponse.json(
      { error: 'No billing profile exists for this account yet.' },
      { status: 400 }
    );
  }

  const session = await createPortalSession({ customerId: subscription.stripeCustomerId });
  return NextResponse.json({ url: session.url });
}
