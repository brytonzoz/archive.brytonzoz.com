import React from 'react';
import type { Metadata } from 'next';
import { Dashboard } from '../../components/admin/Dashboard';

export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false, follow: false },
  alternates: { canonical: '/admin/' },
};

export default function AdminPage() {
  return (
    <div className="min-h-screen bg-black font-body text-white">
      <Dashboard />
    </div>
  );
}
