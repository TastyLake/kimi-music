import { PlaylistClient } from './PlaylistClient';

export const dynamic = 'force-static';
export const dynamicParams = false;

export async function generateStaticParams() {
  return [];
}

export default function PlaylistPage() {
  return <PlaylistClient />;
}