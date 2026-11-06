export interface GenreTag {
  name: string;
  primary: boolean;
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  year: number | null;
  duration: number;
  coverUrl: string | null;
  status: 'PARSED' | 'NEEDS_REVIEW';
  genres: GenreTag[];
  createdAt: string;
  isFavorite?: boolean;
  // только для администратора
  filePath?: string;
  fileSize?: number;
  owner?: string;
}

export interface User {
  id: string;
  username: string;
  email: string;
  role: 'ADMIN' | 'USER';
  canUpload: boolean;
}

export interface Session {
  user: User;
  accessToken: string;
  refreshToken: string;
  streamToken: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface PlaylistSummary {
  id: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  coverUrl: string | null;
  trackCount: number;
  owner: string;
  isMine: boolean;
  updatedAt: string;
}

export interface PlaylistDownload {
  id: string;
  artist: string;
  title: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  progress: number | null;
  error: string | null;
}

export interface PlaylistDetail {
  id: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  isMine: boolean;
  owner: string;
  tracks: Track[];
  downloads: PlaylistDownload[];
}

export interface FiltersMeta {
  genres: { name: string; count: number }[];
  years: { min: number | null; max: number | null };
}

export interface ExternalItem {
  artist: string;
  title: string;
  album?: string;
  coverUrl?: string;
  previewUrl?: string;
  externalUrl?: string;
  releaseDate?: string;
  source: 'lastfm' | 'deezer';
  local: { trackId: string; coverUrl: string | null; duration: number } | null;
  downloadStatus: 'PENDING' | 'PROCESSING' | null;
}

export interface DiscoverResponse {
  kind: 'chart' | 'new' | 'genre';
  source: 'lastfm' | 'deezer';
  label?: string;
  items: ExternalItem[];
}

export interface DiscoverMeta {
  lastfmEnabled: boolean;
  countries: { code: string; name: string }[];
  genres: { tag: string; label: string }[];
}