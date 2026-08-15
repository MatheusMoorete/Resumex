import { describe, expect, it } from 'vitest';
import { buildAuthHeaders, setAuthTokenGetter } from '../../features/auth/services/authClient';

describe('Frontend Sanity Check', () => {
  it('should verify test environment is functional', () => {
    expect(true).toBe(true);
  });

  it('uses the latest access token for each authenticated request', async () => {
    let token = 'expired-token';
    setAuthTokenGetter(async () => token);

    try {
      expect(await buildAuthHeaders()).toEqual({ Authorization: 'Bearer expired-token' });

      token = 'refreshed-token';
      expect(await buildAuthHeaders()).toEqual({ Authorization: 'Bearer refreshed-token' });
    } finally {
      setAuthTokenGetter(null);
    }
  });
});
