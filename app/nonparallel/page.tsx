import React from 'react';
import { MerchPage } from '../../components/store/MerchPage';
import { merchMetadata } from '../../lib/merch-metadata';

export const metadata = merchMetadata();

export default function Page() {
  return <MerchPage />;
}
