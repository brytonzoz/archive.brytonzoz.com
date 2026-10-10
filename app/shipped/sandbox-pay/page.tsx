import React from 'react';
import type { Metadata } from 'next';
import { SandboxPay } from '../../../components/shipped/SandboxPay';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: { absolute: 'Test checkout | Shipped' },
};

export default function SandboxPayPage() {
  return <SandboxPay />;
}
