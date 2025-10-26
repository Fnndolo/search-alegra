import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: '*', // En producción, cambiar a tu dominio del frontend
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
export class WebsocketsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private logger = new Logger('WebsocketsGateway');

  handleConnection(client: Socket) {
    this.logger.log(`✅ Cliente conectado: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`❌ Cliente desconectado: ${client.id}`);
  }

  @SubscribeMessage('join:room')
  handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { store: string; type: string },
  ) {
    const room = `${data.store}-${data.type}`;
    client.join(room);
    this.logger.log(`📍 Cliente ${client.id} se unió a sala: ${room}`);
    
    return { event: 'joined', room };
  }

  @SubscribeMessage('leave:room')
  handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { store: string; type: string },
  ) {
    const room = `${data.store}-${data.type}`;
    client.leave(room);
    this.logger.log(`🚪 Cliente ${client.id} salió de sala: ${room}`);
    
    return { event: 'left', room };
  }

  // ============================================
  // MÉTODOS PARA EMITIR EVENTOS A LAS SALAS
  // ============================================

  /**
   * Emite evento de factura de VENTA creada
   */
  emitInvoiceCreated(store: string, invoice: any) {
    const room = `${store}-sales`;
    this.server.to(room).emit('invoice:created', invoice);
    this.logger.log(`✨ Evento invoice:created emitido a sala ${room}`);
  }

  /**
   * Emite evento de factura de VENTA actualizada
   */
  emitInvoiceUpdated(store: string, invoice: any) {
    const room = `${store}-sales`;
    this.server.to(room).emit('invoice:updated', invoice);
    this.logger.log(`🔄 Evento invoice:updated emitido a sala ${room}`);
  }

  /**
   * Emite evento de factura de VENTA eliminada
   */
  emitInvoiceDeleted(store: string, invoiceId: string | number) {
    const room = `${store}-sales`;
    this.server.to(room).emit('invoice:deleted', invoiceId);
    this.logger.log(`🗑️ Evento invoice:deleted emitido a sala ${room}`);
  }

  /**
   * Emite evento de factura de COMPRA creada
   */
  emitBillCreated(store: string, bill: any) {
    const room = `${store}-purchases`;
    this.server.to(room).emit('bill:created', bill);
    this.logger.log(`✨ Evento bill:created emitido a sala ${room}`);
  }

  /**
   * Emite evento de factura de COMPRA actualizada
   */
  emitBillUpdated(store: string, bill: any) {
    const room = `${store}-purchases`;
    this.server.to(room).emit('bill:updated', bill);
    this.logger.log(`🔄 Evento bill:updated emitido a sala ${room}`);
  }

  /**
   * Emite evento de factura de COMPRA eliminada
   */
  emitBillDeleted(store: string, billId: string | number) {
    const room = `${store}-purchases`;
    this.server.to(room).emit('bill:deleted', billId);
    this.logger.log(`🗑️ Evento bill:deleted emitido a sala ${room}`);
  }
}
