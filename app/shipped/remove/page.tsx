import React from 'react';
import type { Metadata } from 'next';
import { RemoveForm } from '../../../components/shipped/RemoveForm';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: { absolute: 'Remove a receipt | Shipped' },
  description: 'Ask for a printed Shipped receipt to be taken down.',
};

export default function RemovePage() {
  return <RemoveForm />;
}
