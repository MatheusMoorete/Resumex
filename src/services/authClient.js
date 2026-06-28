let tokenGetter = null;

export function setAuthTokenGetter(getter) {
  tokenGetter = getter;
}

export async function buildAuthHeaders() {
  if (!tokenGetter) return {};

  const token = await tokenGetter();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
