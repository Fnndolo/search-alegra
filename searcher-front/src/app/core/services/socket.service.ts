import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class SocketService {
  private socket: Socket;

  constructor() {
    // Crear conexión con socket.io-client directamente
    this.socket = io(environment.socketUrl || 'http://localhost:3000', {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
      autoConnect: false // No conectar automáticamente
    });
  }

  // Conectar al servidor WebSocket
  connect() {
    this.socket.connect();
  }

  // Desconectar del servidor WebSocket
  disconnect() {
    this.socket.disconnect();
  }

  // Escuchar evento de factura de VENTA creada
  onInvoiceCreated(): Observable<any> {
    return new Observable(observer => {
      this.socket.on('invoice:created', (data) => {
        observer.next(data);
      });

      // Cleanup al desuscribirse
      return () => {
        this.socket.off('invoice:created');
      };
    });
  }

  // Escuchar evento de factura de VENTA actualizada
  onInvoiceUpdated(): Observable<any> {
    return new Observable(observer => {
      this.socket.on('invoice:updated', (data) => {
        observer.next(data);
      });

      return () => {
        this.socket.off('invoice:updated');
      };
    });
  }

  // Escuchar evento de factura de VENTA eliminada
  onInvoiceDeleted(): Observable<any> {
    return new Observable(observer => {
      this.socket.on('invoice:deleted', (data) => {
        observer.next(data);
      });

      return () => {
        this.socket.off('invoice:deleted');
      };
    });
  }

  // Escuchar evento de factura de COMPRA creada
  onBillCreated(): Observable<any> {
    return new Observable(observer => {
      this.socket.on('bill:created', (data) => {
        observer.next(data);
      });

      return () => {
        this.socket.off('bill:created');
      };
    });
  }

  // Escuchar evento de factura de COMPRA actualizada
  onBillUpdated(): Observable<any> {
    return new Observable(observer => {
      this.socket.on('bill:updated', (data) => {
        observer.next(data);
      });

      return () => {
        this.socket.off('bill:updated');
      };
    });
  }

  // Escuchar evento de factura de COMPRA eliminada
  onBillDeleted(): Observable<any> {
    return new Observable(observer => {
      this.socket.on('bill:deleted', (data) => {
        observer.next(data);
      });

      return () => {
        this.socket.off('bill:deleted');
      };
    });
  }

  // Unirse a una sala específica (tienda + tipo)
  joinRoom(store: string, type: string) {
    this.socket.emit('join:room', { store, type });
  }

  // Salir de una sala
  leaveRoom(store: string, type: string) {
    this.socket.emit('leave:room', { store, type });
  }

  // Verificar si está conectado
  isConnected(): boolean {
    return this.socket.connected;
  }
}
