import React from 'react';
import type { Metadata } from 'next';
import { OrderPage } from '../../../components/store/OrderPage';

export const metadata: Metadata = {
  title: 'Order',
  robots: { index: false, follow: false },
  alternates: { canonical: '/scrapwrk/order/' },
};

export default function Page() {
  return <OrderPage />;
}
