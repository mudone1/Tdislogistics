// Travelport OAuth 2.0 (password grant) — token is valid 24h, so callers
// should cache/reuse it rather than requesting a new one per call.
// See: https://support.travelport.com/webhelp/JSONAPIs/Airv11/Content/GeneralProject/Oauth.htm

interface TravelportTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getTravelportAccessToken(): Promise<string> {
  // Reuse cached token if it still has more than 60s of life left.
  if (cachedToken && cachedToken.expiresAt - Date.now() > 60_000) {
    return cachedToken.token;
  }

  const authUrl = process.env.TRAVELPORT_AUTH_URL;
  const username = process.env.TRAVELPORT_USERNAME;
  const password = process.env.TRAVELPORT_PASSWORD;
  const clientId = process.env.TRAVELPORT_CLIENT_ID;
  const clientSecret = process.env.TRAVELPORT_CLIENT_SECRET;

  if (!authUrl || !username || !password || !clientId || !clientSecret) {
    throw new Error(
      "Missing Travelport credentials — expected TRAVELPORT_AUTH_URL, TRAVELPORT_USERNAME, TRAVELPORT_PASSWORD, TRAVELPORT_CLIENT_ID, TRAVELPORT_CLIENT_SECRET"
    );
  }

  const body = new URLSearchParams({
    grant_type: "password",
    username,
    password,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(authUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Travelport OAuth failed: HTTP ${res.status} — ${text.slice(0, 500)}`);
  }

  const data = JSON.parse(text) as TravelportTokenResponse;
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.token;
}
