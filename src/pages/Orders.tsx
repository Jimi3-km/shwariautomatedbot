import React, { useState } from 'react';
import { ShoppingCart } from 'lucide-react';
import { getOrders, updateOrder } from '../lib/api';
import type { Order, OrderStatus } from '../types';
import { useAsync, useIsMobile, useMutation } from '../hooks';
import { useSession } from '../app/SessionContext';
import {
  Card, EmptyState, ErrorState, FilterChip, InlineError, LoadingState,
  PageHeader, Pill, Select, TableWrap, useToast,
} from '../components/ui';
import { formatDateTime, formatMoney, humanize } from '../lib/format';

const STATUSES: OrderStatus[] = ['pending', 'confirmed', 'delivered', 'cancelled'];

const TONE: Record<OrderStatus, 'success' | 'warning' | 'danger' | 'info'> = {
  delivered: 'success', confirmed: 'info', cancelled: 'danger', pending: 'warning',
};

export function Orders() {
  const { canWrite, currency } = useSession();
  const isMobile = useIsMobile();
  const toast = useToast();
  const [status, setStatus] = useState<OrderStatus | ''>('');

  const state = useAsync(() => getOrders(status || undefined), [status]);
  const orders = state.data?.orders ?? [];

  const change = useMutation(async (order: Order, next: OrderStatus) => {
    await updateOrder(order.id, { status: next });
    toast.push('success', `Order ${order.order_ref} marked ${next}.`);
    state.reload();
  });

  function itemsLabel(o: Order): string {
    if (!Array.isArray(o.items) || o.items.length === 0) return '—';
    return o.items.map((i) => i.name ?? i.product ?? 'Item').join(', ');
  }

  return (
    <>
      <PageHeader title="Orders" subtitle="Every order placed through your channels." />

      <div style={{ padding: '14px 20px 0', display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        <FilterChip active={status === ''} onClick={() => setStatus('')}>All</FilterChip>
        {STATUSES.map((s) => (
          <FilterChip key={s} active={status === s} onClick={() => setStatus(status === s ? '' : s)}>
            {humanize(s)}
          </FilterChip>
        ))}
      </div>

      <InlineError message={change.error} />

      <div className="scroll-y" style={{ flex: 1, padding: 20 }}>
        {state.loading && !state.data ? (
          <LoadingState rows={5} />
        ) : state.error ? (
          <ErrorState message={state.error} onRetry={state.reload} />
        ) : orders.length === 0 ? (
          <EmptyState
            icon={<ShoppingCart size={26} />}
            title={status ? `No ${status} orders` : 'No orders yet'}
            body="Orders appear here once customers confirm what they want to buy."
          />
        ) : isMobile ? (
          <div style={{ display: 'grid', gap: 10 }}>
            {orders.map((o) => (
              <Card key={o.id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="mono" style={{ flex: 1, fontSize: 12.5 }}>{o.order_ref}</span>
                  <Pill tone={TONE[o.status]}>{humanize(o.status)}</Pill>
                </div>
                <div style={{ fontSize: 17, fontWeight: 600, marginTop: 6 }}>
                  {formatMoney(o.total, o.currency ?? currency)}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 4 }}>{itemsLabel(o)}</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
                  <Pill tone={o.payment_status === 'paid' ? 'success' : 'warning'}>
                    {humanize(o.payment_status)}
                  </Pill>
                  <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{formatDateTime(o.created_at)}</span>
                </div>
                {canWrite && (
                  <div style={{ marginTop: 10 }}>
                    <Select
                      aria-label={`Status for ${o.order_ref}`}
                      value={o.status} disabled={change.busy}
                      onChange={(e) => change.run(o, e.target.value as OrderStatus)}
                      options={STATUSES.map((s) => ({ value: s, label: humanize(s) }))}
                      style={{ height: 30, fontSize: 12.5 }}
                    />
                  </div>
                )}
              </Card>
            ))}
          </div>
        ) : (
          <TableWrap>
            <table className="tbl" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Reference</th><th>Customer</th><th>Items</th><th>Amount</th>
                  <th>Payment</th><th>Status</th><th>Delivery</th><th>Created</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td className="mono primary" style={{ fontSize: 12.5 }}>{o.order_ref}</td>
                    <td style={{ fontSize: 12.5 }}>{o.customer_id || '—'}</td>
                    <td style={{ fontSize: 12.5, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {itemsLabel(o)}
                    </td>
                    <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}>
                      {formatMoney(o.total, o.currency ?? currency)}
                    </td>
                    <td>
                      <Pill tone={o.payment_status === 'paid' ? 'success' : 'warning'}>
                        {humanize(o.payment_status)}
                      </Pill>
                    </td>
                    <td>
                      {canWrite ? (
                        <Select
                          aria-label={`Status for ${o.order_ref}`}
                          value={o.status} disabled={change.busy}
                          onChange={(e) => change.run(o, e.target.value as OrderStatus)}
                          options={STATUSES.map((s) => ({ value: s, label: humanize(s) }))}
                          style={{ height: 28, fontSize: 12, width: 135 }}
                        />
                      ) : (
                        <Pill tone={TONE[o.status]}>{humanize(o.status)}</Pill>
                      )}
                    </td>
                    <td style={{ fontSize: 12.5 }}>{o.delivery_location || '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                      {formatDateTime(o.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </div>
    </>
  );
}
