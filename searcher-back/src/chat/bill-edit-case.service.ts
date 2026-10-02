import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BillEditCase, BillEditCaseStatus } from '../entities/bill-edit-case.entity';
import { BillEditAudit, BillFieldChange } from '../entities/bill-edit-audit.entity';
import { Bill } from '../entities/bill.entity';
import { GoogleChatClient } from './google-chat.client';
import { parseCaseMessage } from './chat-message.parser';

export interface ChatMessageEvent {
  space?: { name?: string };
  message?: {
    name?: string;
    text?: string;
    argumentText?: string;
    thread?: { name?: string };
    sender?: { displayName?: string; name?: string; type?: string };
  };
}

@Injectable()
export class BillEditCaseService {
  private readonly logger = new Logger(BillEditCaseService.name);

  constructor(
    @InjectRepository(BillEditCase)
    private readonly caseRepo: Repository<BillEditCase>,
    @InjectRepository(BillEditAudit)
    private readonly auditRepo: Repository<BillEditAudit>,
    @InjectRepository(Bill)
    private readonly billRepo: Repository<Bill>,
    private readonly chatClient: GoogleChatClient,
  ) {}

  /**
   * Procesa un mensaje del espacio de Chat. Devuelve el texto con que el bot
   * debe responder en el hilo (Chat lo publica a partir del valor retornado).
   */
  async handleChatMessage(event: ChatMessageEvent): Promise<string> {
    const spaceName = event?.space?.name || '';
    const threadName = event?.message?.thread?.name || '';
    const sender = event?.message?.sender?.displayName || event?.message?.sender?.name || null;

    // `argumentText` ya viene sin la mención al bot; si no está, se usa el texto crudo
    const rawText = event?.message?.argumentText ?? event?.message?.text ?? '';

    if (!spaceName || !threadName) {
      return '⚠️ No pude identificar el espacio o el hilo del mensaje.';
    }

    const allowedSpace = this.chatClient.allowedSpace;
    if (allowedSpace && allowedSpace !== spaceName) {
      this.logger.warn(`Mensaje de un espacio no autorizado: ${spaceName}`);
      return '⚠️ Este espacio no está habilitado para abrir casos de edición.';
    }

    const parsed = parseCaseMessage(rawText);
    if (!parsed.ok) {
      return `⚠️ ${parsed.error}\n\nEjemplo: \`@SmartAlegra compra 1280 medellin\``;
    }

    const store = parsed.store!;
    const billNumber = parsed.billNumber!;

    // Un hilo = un caso. Si ya se abrió caso en este hilo, no se duplica.
    const existing = await this.caseRepo.findOne({ where: { threadName } });
    if (existing) {
      if (existing.status === BillEditCaseStatus.USED) {
        return (
          `ℹ️ Este caso ya se usó para editar la compra *${existing.billNumber}* de ${existing.store}` +
          (existing.usedByUsername ? ` (${existing.usedByUsername})` : '') +
          '.\nPara editarla otra vez, abra un hilo nuevo.'
        );
      }
      return `ℹ️ Este hilo ya tiene un caso abierto para la compra *${existing.billNumber}* de ${existing.store}.`;
    }

    const bill = await this.findBillByNumber(store, billNumber);
    if (!bill) {
      await this.caseRepo.save(
        this.caseRepo.create({
          store,
          billNumber,
          billId: null,
          spaceName,
          threadName,
          openedByChatUser: sender,
          openingMessage: rawText,
          status: BillEditCaseStatus.INVALID,
        }),
      );
      return `❌ No encontré la factura de compra *${billNumber}* en ${store}. Verifique el número y la sede.`;
    }

    await this.caseRepo.save(
      this.caseRepo.create({
        store,
        billNumber,
        billId: String(bill.data?.id ?? bill.id),
        spaceName,
        threadName,
        openedByChatUser: sender,
        openingMessage: rawText,
        status: BillEditCaseStatus.OPEN,
      }),
    );

    const provider = bill.data?.provider?.name || 'proveedor desconocido';
    return (
      `✅ Caso abierto para la factura de compra *${billNumber}* de ${store} (${provider}).\n` +
      'Ya está habilitada para UNA edición desde la plataforma. ' +
      'Cuando se guarde, publicaré aquí el detalle de los cambios.'
    );
  }

  /** Busca la compra por sede + número, contemplando las dos formas en que Alegra lo guarda */
  private async findBillByNumber(store: string, billNumber: string): Promise<Bill | null> {
    return this.billRepo
      .createQueryBuilder('bill')
      .where('bill.store = :store', { store })
      .andWhere(
        `(bill.data->'numberTemplate'->>'number' = :number OR bill.data->>'number' = :number)`,
        { number: billNumber },
      )
      .orderBy('bill.id', 'DESC')
      .getOne();
  }

  /** Caso vigente que habilita editar esa factura, si lo hay */
  async findOpenCase(store: string, billId: string): Promise<BillEditCase | null> {
    return this.caseRepo.findOne({
      where: { store, billId: String(billId), status: BillEditCaseStatus.OPEN },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Marca el caso como usado y deja el registro de la edición, publicándolo
   * además en el hilo de Chat. Nunca lanza: la edición en Alegra ya ocurrió y
   * un fallo de Chat no debe presentarse como si la edición hubiera fallado.
   */
  async recordEdit(params: {
    store: string;
    billId: string;
    billNumber: string | null;
    user: { id: number | null; username: string; role: string };
    changes: BillFieldChange[];
    openCase: BillEditCase | null;
  }): Promise<void> {
    const { store, billId, billNumber, user, changes, openCase } = params;

    let chatNotified = false;
    let chatError: string | null = null;

    if (openCase) {
      openCase.status = BillEditCaseStatus.USED;
      openCase.usedAt = new Date();
      openCase.usedByUserId = user.id;
      openCase.usedByUsername = user.username;
      try {
        await this.caseRepo.save(openCase);
      } catch (error: any) {
        this.logger.error(`No se pudo cerrar el caso ${openCase.id}: ${error?.message}`);
      }

      const result = await this.chatClient.postToThread(
        openCase.spaceName,
        openCase.threadName,
        this.buildChatSummary({ store, billNumber: billNumber || openCase.billNumber, user, changes }),
      );
      chatNotified = result.ok;
      chatError = result.error || null;
      if (!result.ok) {
        this.logger.warn(`Edición registrada pero no se publicó en Chat: ${result.error}`);
      }
    }

    try {
      await this.auditRepo.save(
        this.auditRepo.create({
          store,
          billId: String(billId),
          billNumber,
          userId: user.id,
          username: user.username,
          userRole: user.role,
          changes,
          caseId: openCase?.id ?? null,
          threadName: openCase?.threadName ?? null,
          chatNotified,
          chatError,
        }),
      );
    } catch (error: any) {
      this.logger.error(`No se pudo guardar la auditoría de la compra ${billId}: ${error?.message}`);
    }
  }

  /** Mensaje que se publica en el hilo con el detalle de lo editado */
  private buildChatSummary(params: {
    store: string;
    billNumber: string | null;
    user: { username: string; role: string };
    changes: BillFieldChange[];
  }): string {
    const when = new Intl.DateTimeFormat('es-CO', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'America/Bogota',
    }).format(new Date());

    const header =
      `✅ *Factura de compra ${params.billNumber ?? ''} (${params.store}) editada*\n` +
      `• Por: ${params.user.username} (${params.user.role})\n` +
      `• Fecha: ${when} (hora Colombia)\n`;

    if (params.changes.length === 0) {
      return header + '• Cambios: se guardó sin modificaciones detectables.';
    }

    const lines = params.changes
      .map((c) => `   • ${c.label}: "${this.short(c.before)}" → "${this.short(c.after)}"`)
      .join('\n');

    return `${header}• Cambios:\n${lines}\n\nEste caso queda cerrado. Para otra edición, abra un hilo nuevo.`;
  }

  private short(value: any): string {
    if (value === null || value === undefined || value === '') return '(vacío)';
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return text.length > 80 ? text.slice(0, 77) + '…' : text;
  }
}
