import { BillEditCaseService, ChatMessageEvent } from './bill-edit-case.service';
import { BillEditCaseStatus } from '../entities/bill-edit-case.entity';

/** Evento MESSAGE como lo manda Google Chat */
const event = (text: string, overrides: Partial<ChatMessageEvent> = {}): ChatMessageEvent => ({
  space: { name: 'spaces/AAA' },
  message: {
    argumentText: text,
    thread: { name: 'spaces/AAA/threads/T1' },
    sender: { displayName: 'Samuel Vega' },
  },
  ...overrides,
});

describe('BillEditCaseService', () => {
  let caseRepo: any;
  let auditRepo: any;
  let billRepo: any;
  let chatClient: any;
  let service: BillEditCaseService;
  let billFound: any;

  beforeEach(() => {
    billFound = { id: 1280, data: { id: '9001', provider: { name: 'ALFET STORE MEDELLIN' } } };

    caseRepo = {
      saved: [] as any[],
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((x) => ({ id: 'case-1', createdAt: new Date(), ...x })),
      save: jest.fn(function (x: any) {
        caseRepo.saved.push(x);
        return Promise.resolve(x);
      }),
    };
    auditRepo = {
      saved: [] as any[],
      create: jest.fn((x) => x),
      save: jest.fn(function (x: any) {
        auditRepo.saved.push(x);
        return Promise.resolve(x);
      }),
    };
    billRepo = {
      createQueryBuilder: jest.fn(() => ({
        where: function () { return this; },
        andWhere: function () { return this; },
        orderBy: function () { return this; },
        getOne: () => Promise.resolve(billFound),
      })),
    };
    chatClient = {
      allowedSpace: undefined,
      postToThread: jest.fn().mockResolvedValue({ ok: true }),
    };

    service = new BillEditCaseService(caseRepo, auditRepo, billRepo, chatClient);
  });

  describe('handleChatMessage', () => {
    it('abre el caso cuando el mensaje es válido y la factura existe', async () => {
      const reply = await service.handleChatMessage(event('compra 1280 medellin'));

      expect(reply).toContain('Caso abierto');
      expect(reply).toContain('1280');
      const saved = caseRepo.saved[0];
      expect(saved).toMatchObject({
        store: 'medellin',
        billNumber: '1280',
        billId: '9001',
        threadName: 'spaces/AAA/threads/T1',
        status: BillEditCaseStatus.OPEN,
        openedByChatUser: 'Samuel Vega',
      });
    });

    it('NO abre caso si la factura no existe, y lo deja marcado como inválido', async () => {
      billFound = null;
      const reply = await service.handleChatMessage(event('compra 99999 pasto'));

      expect(reply).toContain('No encontré');
      expect(caseRepo.saved[0].status).toBe(BillEditCaseStatus.INVALID);
    });

    it('NO abre caso con mensajes mal formados y explica el formato', async () => {
      const reply = await service.handleChatMessage(event('corregir factura de compra'));
      expect(reply).toContain('número');
      expect(caseRepo.saved).toHaveLength(0);
    });

    it('rechaza facturas de venta: exige la palabra compra', async () => {
      const reply = await service.handleChatMessage(event('venta 3195 medellin'));
      expect(reply).toContain('compra');
      expect(caseRepo.saved).toHaveLength(0);
    });

    it('no duplica el caso si el hilo ya tiene uno', async () => {
      caseRepo.findOne.mockResolvedValue({ status: BillEditCaseStatus.OPEN, billNumber: '1280', store: 'medellin' });
      const reply = await service.handleChatMessage(event('compra 1280 medellin'));

      expect(reply).toContain('ya tiene un caso abierto');
      expect(caseRepo.saved).toHaveLength(0);
    });

    it('avisa que el caso ya se consumió y pide abrir un hilo nuevo', async () => {
      caseRepo.findOne.mockResolvedValue({
        status: BillEditCaseStatus.USED,
        billNumber: '1280',
        store: 'medellin',
        usedByUsername: 'jcastro',
      });
      const reply = await service.handleChatMessage(event('compra 1280 medellin'));

      expect(reply).toContain('ya se usó');
      expect(reply).toContain('hilo nuevo');
      expect(caseRepo.saved).toHaveLength(0);
    });

    it('ignora espacios no autorizados cuando se restringe uno', async () => {
      chatClient.allowedSpace = 'spaces/PERMITIDO';
      const reply = await service.handleChatMessage(event('compra 1280 medellin'));

      expect(reply).toContain('no está habilitado');
      expect(caseRepo.saved).toHaveLength(0);
    });
  });

  describe('recordEdit', () => {
    const user = { id: 7, username: 'jcastro', role: 'inventario_compras' };
    const changes = [{ field: 'provider', label: 'Proveedor', before: 'A', after: 'B' }];

    it('consume el caso, publica en el hilo y guarda la auditoría', async () => {
      const openCase: any = {
        id: 'case-1',
        spaceName: 'spaces/AAA',
        threadName: 'spaces/AAA/threads/T1',
        billNumber: '1280',
        status: BillEditCaseStatus.OPEN,
      };

      await service.recordEdit({ store: 'medellin', billId: '9001', billNumber: '1280', user, changes, openCase });

      expect(openCase.status).toBe(BillEditCaseStatus.USED);
      expect(openCase.usedByUsername).toBe('jcastro');
      expect(chatClient.postToThread).toHaveBeenCalled();

      const [, , text] = chatClient.postToThread.mock.calls[0];
      expect(text).toContain('jcastro');
      expect(text).toContain('Proveedor');
      expect(text).toContain('queda cerrado');

      expect(auditRepo.saved[0]).toMatchObject({ caseId: 'case-1', chatNotified: true, username: 'jcastro' });
    });

    it('si Chat falla, la auditoría igual se guarda con el error', async () => {
      chatClient.postToThread.mockResolvedValue({ ok: false, error: 'HTTP 403' });
      const openCase: any = { id: 'case-1', spaceName: 's', threadName: 't', billNumber: '1280', status: BillEditCaseStatus.OPEN };

      await service.recordEdit({ store: 'medellin', billId: '9001', billNumber: '1280', user, changes, openCase });

      expect(auditRepo.saved[0]).toMatchObject({ chatNotified: false, chatError: 'HTTP 403' });
      // el caso se consume igual: la edición en Alegra ya ocurrió
      expect(openCase.status).toBe(BillEditCaseStatus.USED);
    });

    it('registra también las ediciones sin caso (admin / compras)', async () => {
      await service.recordEdit({
        store: 'pasto',
        billId: '6214',
        billNumber: '6214',
        user: { id: 1, username: 'admin', role: 'admin' },
        changes,
        openCase: null,
      });

      expect(chatClient.postToThread).not.toHaveBeenCalled();
      expect(auditRepo.saved[0]).toMatchObject({ caseId: null, username: 'admin', chatNotified: false });
    });
  });
});
