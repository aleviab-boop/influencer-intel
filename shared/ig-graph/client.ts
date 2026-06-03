import type {
  IGTokenResponse,
  IGLongLivedTokenResponse,
  IGUserProfile,
  IGMedia,
  IGMediaInsightsResponse,
  IGPaginatedResponse,
  IGAudienceDemographic,
} from './types.js';

const GRAPH_API_BASE = 'https://graph.instagram.com';
const GRAPH_API_VERSION = 'v21.0';

interface RateLimitState {
  remaining: number;
  resetAt: number;
}

export class IGGraphClient {
  private accessToken: string;
  private rateLimitState: RateLimitState = { remaining: 200, resetAt: 0 };

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  private async request<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    await this.waitForRateLimit();
    const url = new URL(`${GRAPH_API_BASE}/${GRAPH_API_VERSION}${path}`);
    url.searchParams.set('access_token', this.accessToken);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const res = await fetch(url.toString());
    this.updateRateLimit(res.headers);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`IG Graph API ${res.status}: ${body}`);
    }
    return res.json() as Promise<T>;
  }

  private updateRateLimit(headers: Headers): void {
    const usage = headers.get('x-business-use-case-usage');
    if (!usage) return;
    try {
      const parsed = JSON.parse(usage);
      const values = Object.values(parsed) as Array<Array<{
        call_count: number;
        estimated_time_to_regain_access?: number;
      }>>;
      const first = values[0]?.[0];
      if (first) {
        this.rateLimitState.remaining = Math.max(0, 200 - (first.call_count * 2));
        if (first.estimated_time_to_regain_access) {
          this.rateLimitState.resetAt = Date.now() + first.estimated_time_to_regain_access * 60_000;
        }
      }
    } catch { /* ignore */ }
  }

  private async waitForRateLimit(): Promise<void> {
    if (this.rateLimitState.remaining <= 5) {
      const waitMs = Math.max(0, this.rateLimitState.resetAt - Date.now());
      if (waitMs > 0) {
        console.log(`[ig-graph] Rate limit near, waiting ${Math.round(waitMs / 1000)}s`);
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
  }

  static async exchangeCodeForToken(
    code: string, clientId: string, clientSecret: string, redirectUri: string,
  ): Promise<IGTokenResponse> {
    const res = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId, client_secret: clientSecret,
        grant_type: 'authorization_code', redirect_uri: redirectUri, code,
      }),
    });
    if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);
    return res.json() as Promise<IGTokenResponse>;
  }

  static async exchangeForLongLived(
    shortLivedToken: string, clientSecret: string,
  ): Promise<IGLongLivedTokenResponse> {
    const url = new URL(`${GRAPH_API_BASE}/${GRAPH_API_VERSION}/access_token`);
    url.searchParams.set('grant_type', 'ig_exchange_token');
    url.searchParams.set('client_secret', clientSecret);
    url.searchParams.set('access_token', shortLivedToken);
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Long-lived token exchange failed: ${await res.text()}`);
    return res.json() as Promise<IGLongLivedTokenResponse>;
  }

  async refreshToken(): Promise<IGLongLivedTokenResponse> {
    const url = new URL(`${GRAPH_API_BASE}/refresh_access_token`);
    url.searchParams.set('grant_type', 'ig_refresh_token');
    url.searchParams.set('access_token', this.accessToken);
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
    const data = await res.json() as IGLongLivedTokenResponse;
    this.accessToken = data.access_token;
    return data;
  }

  async getProfile(): Promise<IGUserProfile> {
    return this.request<IGUserProfile>('/me', {
      fields: 'id,username,name,biography,followers_count,follows_count,media_count,profile_picture_url,website',
    });
  }

  async getMedia(limit = 25, after?: string): Promise<IGPaginatedResponse<IGMedia>> {
    const params: Record<string, string> = {
      fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,shortcode,timestamp,like_count,comments_count',
      limit: String(limit),
    };
    if (after) params.after = after;
    return this.request<IGPaginatedResponse<IGMedia>>('/me/media', params);
  }

  async getAllMedia(maxPosts = 200): Promise<IGMedia[]> {
    const all: IGMedia[] = [];
    let after: string | undefined;
    while (all.length < maxPosts) {
      const batch = await this.getMedia(25, after);
      all.push(...batch.data);
      if (!batch.paging?.cursors?.after || batch.data.length === 0) break;
      after = batch.paging.cursors.after;
    }
    return all.slice(0, maxPosts);
  }

  async getMediaInsights(mediaId: string, mediaType: string): Promise<IGMediaInsightsResponse> {
    const isReel = mediaType === 'VIDEO' || mediaType === 'REELS';
    const metrics = isReel
      ? 'reach,plays,saved,shares,total_interactions,likes,comments'
      : 'reach,impressions,saved,total_interactions,likes,comments';
    return this.request<IGMediaInsightsResponse>(`/${mediaId}/insights`, { metric: metrics });
  }

  async getAudienceDemographics(): Promise<{
    gender_age: Record<string, number>;
    cities: Record<string, number>;
    countries: Record<string, number>;
  }> {
    const [genderAge, cities, countries] = await Promise.all([
      this.request<{ data: IGAudienceDemographic[] }>('/me/insights', {
        metric: 'follower_demographics', period: 'lifetime',
        metric_type: 'total_value', breakdown: 'age,gender',
      }).catch(() => ({ data: [] as IGAudienceDemographic[] })),
      this.request<{ data: IGAudienceDemographic[] }>('/me/insights', {
        metric: 'follower_demographics', period: 'lifetime',
        metric_type: 'total_value', breakdown: 'city',
      }).catch(() => ({ data: [] as IGAudienceDemographic[] })),
      this.request<{ data: IGAudienceDemographic[] }>('/me/insights', {
        metric: 'follower_demographics', period: 'lifetime',
        metric_type: 'total_value', breakdown: 'country',
      }).catch(() => ({ data: [] as IGAudienceDemographic[] })),
    ]);
    return {
      gender_age: genderAge.data[0]?.values[0]?.value ?? {},
      cities: cities.data[0]?.values[0]?.value ?? {},
      countries: countries.data[0]?.values[0]?.value ?? {},
    };
  }
}
