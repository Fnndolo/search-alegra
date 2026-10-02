import { GoogleChatClient } from './google-chat.client';

const configWith = (values: Record<string, string | undefined>) =>
  ({ get: (k: string) => values[k] }) as any;

describe('GoogleChatClient', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('verifyRequest', () => {
    it('falla cerrado si no hay audiencia configurada', async () => {
      const client = new GoogleChatClient(configWith({}));
      const r = await client.verifyRequest('Bearer loquesea');

      expect(r.ok).toBe(false);
      expect(r.error).toContain('GOOGLE_CHAT_AUDIENCE');
    });

    it('rechaza si no viene el header de autorización', async () => {
      const client = new GoogleChatClient(configWith({ GOOGLE_CHAT_AUDIENCE: '123' }));

      expect((await client.verifyRequest(undefined)).ok).toBe(false);
      expect((await client.verifyRequest('')).ok).toBe(false);
      expect((await client.verifyRequest('Bearer    ')).ok).toBe(false);
    });

    it('rechaza un token que no está firmado por Chat', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ kid1: '-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----' }),
        headers: { get: () => 'public, max-age=3600' },
      }) as any;

      const client = new GoogleChatClient(configWith({ GOOGLE_CHAT_AUDIENCE: '123' }));
      const r = await client.verifyRequest('Bearer token.falso.aqui');

      expect(r.ok).toBe(false);
      expect(r.error).toBeTruthy();
    });

    it('cachea los certificados en vez de pedirlos en cada evento', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ kid1: 'cert' }),
        headers: { get: () => 'public, max-age=3600' },
      });
      global.fetch = fetchMock as any;

      const client = new GoogleChatClient(configWith({ GOOGLE_CHAT_AUDIENCE: '123' }));
      await client.verifyRequest('Bearer a.b.c');
      await client.verifyRequest('Bearer d.e.f');

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('postToThread', () => {
    it('no publica ni revienta si faltan credenciales de la cuenta de servicio', async () => {
      const client = new GoogleChatClient(configWith({ GOOGLE_CHAT_AUDIENCE: '123' }));
      const r = await client.postToThread('spaces/A', 'spaces/A/threads/T', 'hola');

      expect(r.ok).toBe(false);
      expect(r.error).toContain('GOOGLE_CHAT_SA_EMAIL');
    });
  });

  describe('configuración', () => {
    it('reporta correctamente qué está configurado', () => {
      const vacio = new GoogleChatClient(configWith({}));
      expect(vacio.isVerificationConfigured()).toBe(false);
      expect(vacio.isPostingConfigured()).toBe(false);

      const completo = new GoogleChatClient(
        configWith({
          GOOGLE_CHAT_AUDIENCE: '123',
          GOOGLE_CHAT_SA_EMAIL: 'bot@proyecto.iam.gserviceaccount.com',
          GOOGLE_CHAT_SA_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nx\\n-----END PRIVATE KEY-----',
        }),
      );
      expect(completo.isVerificationConfigured()).toBe(true);
      expect(completo.isPostingConfigured()).toBe(true);
    });
  });
});
