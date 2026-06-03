export interface IGTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

export interface IGLongLivedTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface IGUserProfile {
  id: string;
  username: string;
  name?: string;
  biography?: string;
  followers_count?: number;
  follows_count?: number;
  media_count?: number;
  profile_picture_url?: string;
  website?: string;
}

export interface IGMedia {
  id: string;
  caption?: string;
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM' | 'REELS';
  media_url?: string;
  thumbnail_url?: string;
  permalink: string;
  shortcode: string;
  timestamp: string;
  like_count?: number;
  comments_count?: number;
}

export interface IGMediaInsight {
  name: string;
  period: string;
  values: Array<{ value: number }>;
  title: string;
}

export interface IGMediaInsightsResponse {
  data: IGMediaInsight[];
}

export interface IGPaginatedResponse<T> {
  data: T[];
  paging?: {
    cursors?: { before?: string; after?: string };
    next?: string;
    previous?: string;
  };
}

export interface IGAudienceDemographic {
  name: string;
  period: string;
  values: Array<{
    value: Record<string, number>;
    end_time?: string;
  }>;
}
