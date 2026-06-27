/**
 * /api/payment/* endpoints. Auth required for create-order; webhook is
 * server-to-server (called by Razorpay, not the client).
 */
import { apiPost } from './client';
import type { CreateOrderResponse, Plan } from './types';

export function createOrder(plan: Plan): Promise<CreateOrderResponse> {
  return apiPost<CreateOrderResponse>('/api/payment/create-order', { plan });
}