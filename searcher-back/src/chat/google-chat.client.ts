import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JWT, OAuth2Client } from 'google-auth-library';

/** Emisor de los tokens con que Google Chat firma sus webhooks */
const CHAT_ISSUER = 'chat@system.gserviceaccount.com';
const CHAT_CERTS_URL = 'https://www.googleapis.com/service_accounts/v1/metadata/x509/chat@system.gserviceaccount.com';
const CHAT_API = 'https://chat.googleapis.com/v1';
const CHAT_SCOPE = 'https://www.googleapis.com/auth/chat.bot';

/**
 * Cliente de Google Chat: verifica los webhooks entrantes y publica respuestas
 * dentro de un hilo.
 *
 * Se configura por entorno y **degrada sin romper**: si faltan credenciales, el
 * webhook rechaza todo (en vez de abrir casos sin autenticar) y la publicación
 * devuelve un error que queda registrado en la auditoría, sin tumbar la edición.
 */
@Injectable()
export class GoogleChatClient {
  private readonly logger = new Logger(GoogleChatClient.name);
  private readonly oAuthClient = new OAuth2Client();
  private jwtClient: JWT | null = null;
  private certsCache: { certs: Record<string, string>; expiresAt: number } | null = null;

  constructor(private readonly configService: ConfigService) {}

  /** Audiencia esperada en el token del webhook: el número de proyecto de Google Cloud */
  private get audience(): string | undefined {
    return this.configService.get<string>('GOOGLE_CHAT_AUDIENCE');
  }

  private get serviceAccountEmail(): string | undefined {
    return this.configService.get<string>('GOOGLE_CHAT_SA_EMAIL');
  }

  /** La clave llega del entorno con los saltos de línea escapados */
  private get serviceAccountKey(): string | undefined {
    const raw = this.configService.get<string>('GOOGLE_CHAT_SA_PRIVATE_KEY');
    return raw ? raw.replace(/\\n/g, '\n') : undefined;
  }

  /** Espacio permitido; si no se configura, se aceptan casos de cualquier espacio */
  get allowedSpace(): string | undefined {
    return this.configService.get<string>('GOOGLE_CHAT_SPACE');
  }

  isVerificationConfigured(): boolean {
    return !!this.audience;
  }

  isPostingConfigured(): boolean {
    return !!this.serviceAccountEmail && !!this.serviceAccountKey;
  }

  /**
   * Certificados públicos de la cuenta de sistema de Chat, cacheados.
   *
   * No sirve `verifyIdToken`: ese valida contra los certs de inicio de sesión
   * federado de Google, no contra los de `chat@system.gserviceaccount.com`, y
   * rechazaría todos los eventos legítimos.
   */
  private async getChatCerts(): Promise<Record<string, string>> {
    const now = Date.now();
    if (this.certsCache && this.certsCache.expiresAt > now) {
      return this.certsCache.certs;
    }

    const response = await fetch(CHAT_CERTS_URL);
    if (!response.ok) {
      throw new Error(`No se pudieron obtener los certificados de Chat (HTTP ${response.status}).`);
    }
    const certs = (await response.json()) as Record<string, string>;

    // Se respeta el max-age que manda Google; si no viene, 1 hora
    const cacheControl = response.headers.get('cache-control') || '';
    const maxAge = Number(/max-age=(\d+)/.exec(cacheControl)?.[1]) || 3600;
    this.certsCache = { certs, expiresAt: now + maxAge * 1000 };

    return certs;
  }

  /**
   * Verifica que el webhook venga realmente de Google Chat.
   * Es la única barrera del endpoint —que es público y concede permisos de
   * edición—, así que sin configuración se rechaza en vez de dejar pasar.
   */
  async verifyRequest(authorizationHeader?: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.isVerificationConfigured()) {
      return { ok: false, error: 'GOOGLE_CHAT_AUDIENCE no está configurado; no se pueden verificar los eventos de Chat.' };
    }

    const token = (authorizationHeader || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return { ok: false, error: 'Falta el token de autorización.' };
    }

    try {
      const certs = await this.getChatCerts();
      // Valida firma, audiencia y emisor en un solo paso
      await this.oAuthClient.verifySignedJwtWithCertsAsync(token, certs, this.audience, [CHAT_ISSUER]);
      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: error?.message || 'Token inválido.' };
    }
  }

  private getJwtClient(): JWT {
    if (!this.jwtClient) {
      this.jwtClient = new JWT({
        email: this.serviceAccountEmail,
        key: this.serviceAccountKey,
        scopes: [CHAT_SCOPE],
      });
    }
    return this.jwtClient;
  }

  /**
   * Publica un mensaje como respuesta dentro de un hilo existente.
   * Nunca lanza: devuelve el resultado para que quien llama lo registre.
   */
  async postToThread(
    spaceName: string,
    threadName: string,
    text: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!this.isPostingConfigured()) {
      return { ok: false, error: 'Faltan GOOGLE_CHAT_SA_EMAIL / GOOGLE_CHAT_SA_PRIVATE_KEY.' };
    }

    try {
      const { token } = await this.getJwtClient().getAccessToken();
      if (!token) return { ok: false, error: 'No se pudo obtener el token de la cuenta de servicio.' };

      const url =
        `${CHAT_API}/${spaceName}/messages` +
        `?messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, thread: { name: threadName } }),
      });

      if (!response.ok) {
        const body = (await response.text()).slice(0, 300);
        return { ok: false, error: `HTTP ${response.status}: ${body}` };
      }
      return { ok: true };
    } catch (error: any) {
      this.logger.error(`No se pudo publicar en el hilo ${threadName}: ${error?.message}`);
      return { ok: false, error: error?.message || 'Error desconocido publicando en Chat.' };
    }
  }
}
