import React from 'react';
import { StorePage } from '../../components/store/StorePage';
import { storeMetadata } from '../../lib/store-metadata';

export const metadata = storeMetadata();

export default function Page() {
  return <StorePage />;
}
