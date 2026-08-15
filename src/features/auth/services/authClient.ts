type TokenGetter = () => Promise<string | null>;

let tokenGetter: TokenGetter | null = null;

export function setAuthTokenGetter(getter: TokenGetter | null) {
  tokenGetter = getter;
}

export async function buildAuthHeaders(): Promise<Record<string, string>> {
  if (!tokenGetter) return {};

  const token = await tokenGetter();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
