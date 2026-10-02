import { Body, Controller, Headers, Logger, Post, UnauthorizedException } from '@nestjs/common';
import { BillEditCaseService, ChatMessageEvent } from './bill-edit-case.service';
import { GoogleChatClient } from './google-chat.client';

interface ChatEvent extends ChatMessageEvent {
  type?: string;
}

/**
 * Webhook de la app de Google Chat.
 *
 * Es un endpoint PÚBLICO (Google no puede autenticarse con el JWT de la
 * plataforma), así que la verificación del token firmado por Chat es su única
 * barrera: si falla, se rechaza. Lo que responde este endpoint es lo que el bot
 * publica en el hilo.
 */
@Controller('google-chat')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private readonly caseService: BillEditCaseService,
    private readonly chatClient: GoogleChatClient,
  ) {}

  @Post('events')
  async handleEvent(@Headers('authorization') authorization: string, @Body() event: ChatEvent) {
    const verification = await this.chatClient.verifyRequest(authorization);
    if (!verification.ok) {
      this.logger.warn(`Evento de Chat rechazado: ${verification.error}`);
      throw new UnauthorizedException('Evento de Google Chat no verificado.');
    }

    switch (event?.type) {
      case 'ADDED_TO_SPACE':
        return {
          text:
            '👋 Listo. Para habilitar la edición de una factura de compra, abra un hilo nuevo ' +
            'mencionándome así:\n`@SmartAlegra compra 1280 medellin`',
        };

      case 'MESSAGE': {
        const reply = await this.caseService.handleChatMessage(event);
        return { text: reply };
      }

      // Otros eventos (REMOVED_FROM_SPACE, CARD_CLICKED…) no requieren respuesta
      default:
        return {};
    }
  }
}
