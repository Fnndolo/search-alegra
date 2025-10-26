# 🔌 Implementación de WebSocket para Actualizaciones en Tiempo Real

## 📋 Resumen

Se ha implementado un sistema completo de WebSocket usando Socket.IO para enviar actualizaciones en tiempo real de facturas (invoices) y cuentas por pagar (bills) a los clientes conectados. El sistema se integra automáticamente con los webhooks de Alegra.

---

## 🆕 Archivos Creados

### 1. `src/websockets/websockets.gateway.ts`
Gateway principal de WebSocket con las siguientes características:

**Funcionalidades:**
- ✅ Manejo de conexiones/desconexiones de clientes
- ✅ Sistema de rooms basado en formato: `{store}-{type}`
  - Ejemplo: `pasto-sales`, `medellin-purchases`
- ✅ Logging detallado de todas las operaciones

**Métodos de Emisión:**
```typescript
// Invoices (Facturas)
emitInvoiceCreated(store: string, invoice: any)
emitInvoiceUpdated(store: string, invoice: any)
emitInvoiceDeleted(store: string, invoiceId: string)

// Bills (Cuentas por Pagar)
emitBillCreated(store: string, bill: any)
emitBillUpdated(store: string, bill: any)
emitBillDeleted(store: string, billId: string)
```

**Eventos de Cliente:**
- `join-room`: Unirse a un room específico
- `leave-room`: Salir de un room

### 2. `src/websockets/websockets.module.ts`
Módulo NestJS que exporta el WebSocket gateway para uso en otros módulos.

### 3. `test-websocket.html`
Cliente de prueba interactivo con interfaz visual completa:
- 🎨 Interfaz moderna y responsiva
- 📊 Log de eventos en tiempo real
- 🏪 Selector de tiendas (Pasto, Medellín, Armenia, Pereira)
- 📦 Selector de tipo (Sales/Purchases)
- ✅ Estado de conexión visual
- 🔔 Badges de rooms activos

---

## 🔧 Archivos Modificados

### 1. `src/invoices/invoices.service.ts`

**Cambios:**
```typescript
// ANTES
async updateSingleInvoice(store: string, invoiceId: string): Promise<void>

// DESPUÉS
async updateSingleInvoice(store: string, invoiceId: string): Promise<any>
```
- Ahora retorna los datos de la factura actualizada
- Nuevo método: `getInvoiceById(store, invoiceId)` para obtener facturas desde la DB
- Inyecta `bankAccount` en el array `payments` si existe

### 2. `src/bills/bills.service.db.ts`

**Cambios:**
```typescript
// ANTES
async updateSingleBill(store: string, billId: string): Promise<void>

// DESPUÉS
async updateSingleBill(store: string, billId: string): Promise<any>
```
- Ahora retorna los datos de la cuenta actualizada
- Nuevo método: `getBillById(store, billId)` para obtener bills desde la DB

### 3. `src/bills/bills.service.ts`

**Nuevo método añadido:**
```typescript
async getBillById(store: string, billId: string): Promise<any>
```

### 4. `src/webhooks/webhooks.controller.ts`

**Integración con WebSocket:**
```typescript
case 'invoice':
  const invoiceData = await this.invoicesService.updateSingleInvoice(store, entityId);
  
  // Emitir eventos según el tipo de acción
  if (subject.includes('new')) {
    this.websocketsGateway.emitInvoiceCreated(store, invoiceData);
  } else if (subject.includes('edit')) {
    this.websocketsGateway.emitInvoiceUpdated(store, invoiceData);
  } else if (subject.includes('delete')) {
    this.websocketsGateway.emitInvoiceDeleted(store, entityId);
  }
  break;
```

### 5. `src/webhooks/webhooks.module.ts`

**Importación del módulo WebSocket:**
```typescript
imports: [
  ConfigModule,
  SharedModule,
  InvoicesModule,
  BillsModule,
  WebsocketsModule  // ← Nuevo
]
```

---

## 📡 Eventos WebSocket Disponibles

| Evento | Descripción | Room | Datos |
|--------|-------------|------|-------|
| `invoice:created` | Nueva factura creada | `{store}-sales` | Objeto completo de la factura |
| `invoice:updated` | Factura actualizada | `{store}-sales` | Objeto completo de la factura |
| `invoice:deleted` | Factura eliminada | `{store}-sales` | ID de la factura |
| `bill:created` | Nueva cuenta creada | `{store}-purchases` | Objeto completo de la cuenta |
| `bill:updated` | Cuenta actualizada | `{store}-purchases` | Objeto completo de la cuenta |
| `bill:deleted` | Cuenta eliminada | `{store}-purchases` | ID de la cuenta |

---

## 🎯 Sistema de Rooms

Los clientes deben unirse a rooms específicos para recibir eventos:

**Formato:** `{store}-{type}`

**Ejemplos:**
- `pasto-sales` - Facturas de Pasto
- `pasto-purchases` - Cuentas por pagar de Pasto
- `medellin-sales` - Facturas de Medellín
- `medellin-purchases` - Cuentas por pagar de Medellín
- `armenia-sales` - Facturas de Armenia
- `armenia-purchases` - Cuentas por pagar de Armenia
- `pereira-sales` - Facturas de Pereira
- `pereira-purchases` - Cuentas por pagar de Pereira

---

## 💻 Uso en el Cliente (Frontend)

### Instalación de Socket.IO Client

```bash
npm install socket.io-client
```

### Código de Ejemplo - React/Vue/Angular

```javascript
import { io } from 'socket.io-client';

// Conectar al servidor
const socket = io('https://search-alegra-production-5eed.up.railway.app', {
  transports: ['websocket', 'polling']
});

// Eventos de conexión
socket.on('connect', () => {
  console.log('✅ Conectado al WebSocket:', socket.id);
});

socket.on('disconnect', () => {
  console.log('❌ Desconectado del WebSocket');
});

// Unirse a rooms específicos
socket.emit('join-room', { store: 'pasto', type: 'sales' });
socket.emit('join-room', { store: 'pasto', type: 'purchases' });

// Escuchar eventos de facturas
socket.on('invoice:created', (invoice) => {
  console.log('🆕 Nueva factura:', invoice);
  // Actualizar UI, agregar a lista, etc.
});

socket.on('invoice:updated', (invoice) => {
  console.log('✏️ Factura actualizada:', invoice);
  // Actualizar factura en la lista
});

socket.on('invoice:deleted', (data) => {
  console.log('🗑️ Factura eliminada:', data.invoiceId);
  // Remover factura de la lista
});

// Escuchar eventos de cuentas por pagar
socket.on('bill:created', (bill) => {
  console.log('🆕 Nueva cuenta:', bill);
});

socket.on('bill:updated', (bill) => {
  console.log('✏️ Cuenta actualizada:', bill);
});

socket.on('bill:deleted', (data) => {
  console.log('🗑️ Cuenta eliminada:', data.billId);
});

// Salir de un room
socket.emit('leave-room', { store: 'pasto', type: 'sales' });

// Desconectar al cerrar
window.addEventListener('beforeunload', () => {
  socket.disconnect();
});
```

### Código de Ejemplo - JavaScript Vanilla

```html
<!DOCTYPE html>
<html>
<head>
    <script src="https://cdn.socket.io/4.5.4/socket.io.min.js"></script>
</head>
<body>
    <script>
        const socket = io('https://search-alegra-production-5eed.up.railway.app');

        socket.on('connect', () => {
            console.log('Conectado!');
            
            // Unirse a rooms
            socket.emit('join-room', { store: 'pasto', type: 'sales' });
        });

        socket.on('invoice:created', (invoice) => {
            console.log('Nueva factura:', invoice);
            // Aquí actualizas tu UI
        });
    </script>
</body>
</html>
```

---

## 🧪 Cómo Probar

### Opción 1: Usar el Cliente de Prueba HTML

1. Abre el archivo `test-websocket.html` en tu navegador
2. Configura la URL del servidor:
   - Local: `http://localhost:8080`
   - Producción: `https://search-alegra-production-5eed.up.railway.app`
3. Click en "Conectar"
4. Selecciona tienda y tipo, luego "Unirse al Room"
5. Crea o edita una factura/cuenta en Alegra
6. El webhook procesará y verás el evento en tiempo real

### Opción 2: Probar con el Frontend Real

1. Integra el código de ejemplo en tu frontend
2. Asegúrate de unirte a los rooms correctos según la tienda
3. Los eventos llegarán automáticamente cuando haya cambios

---

## 🔄 Flujo de Datos Completo

```
1. Usuario crea/edita factura en Alegra
         ↓
2. Alegra envía webhook POST a nuestro servidor
         ↓
3. WebhooksController procesa el webhook
         ↓
4. InvoicesService/BillsService actualiza la DB
         ↓
5. Retorna los datos actualizados
         ↓
6. WebhooksController emite evento WebSocket
         ↓
7. WebsocketsGateway envía a room específico
         ↓
8. Clientes conectados al room reciben actualización
         ↓
9. Frontend actualiza UI en tiempo real
```

---

## 🛠️ Configuración del Servidor

El WebSocket gateway está configurado para aceptar conexiones desde cualquier origen:

```typescript
@WebSocketGateway({
  cors: { origin: '*' },
  transports: ['websocket', 'polling']
})
```

**En producción, considera restringir los orígenes permitidos:**

```typescript
@WebSocketGateway({
  cors: { 
    origin: ['https://tu-frontend.com', 'http://localhost:3000']
  },
  transports: ['websocket', 'polling']
})
```

---

## 📊 Logging y Debugging

El gateway registra todas las operaciones importantes:

```
[WebsocketsGateway] Cliente conectado: socket_id_123
[WebsocketsGateway] Cliente socket_id_123 se unió al room: pasto-sales
[WebsocketsGateway] Emitiendo invoice:created a room pasto-sales
[WebsocketsGateway] Cliente socket_id_123 salió del room: pasto-sales
[WebsocketsGateway] Cliente desconectado: socket_id_123
```

Revisa los logs del servidor para depurar problemas de conexión.

---

## ⚡ Optimizaciones Implementadas

1. **Uso eficiente de rooms**: Solo los clientes interesados reciben eventos
2. **Datos completos**: Se envía el objeto completo para evitar llamadas adicionales a la API
3. **Transporte dual**: Soporta WebSocket y polling como fallback
4. **Retorno de datos optimizado**: Los métodos de actualización ahora retornan datos directamente
5. **Inyección de bankAccount**: Los datos de facturas incluyen información de pago completa

---

## 🚀 Deploy

Los cambios están en la rama `david` y Railway hace auto-deploy:

```bash
git add .
git commit -m "feat: implementar WebSocket para actualizaciones en tiempo real"
git push origin david
```

Railway detectará los cambios y desplegará automáticamente.

---

## 📦 Dependencias Añadidas

Las siguientes dependencias ya están instaladas en el proyecto:

```json
{
  "@nestjs/websockets": "^10.x",
  "@nestjs/platform-socket.io": "^10.x",
  "socket.io": "^4.x"
}
```

---

## 🔐 Seguridad

**Consideraciones de seguridad:**

1. **CORS**: Actualmente configurado con `origin: '*'` para desarrollo
2. **Autenticación**: Considera agregar autenticación con tokens JWT
3. **Rate limiting**: Implementar límites de conexión por IP
4. **Validación de rooms**: Solo permitir rooms válidos

**Ejemplo de autenticación (futuro):**

```typescript
@SubscribeMessage('join-room')
handleJoinRoom(
  @ConnectedSocket() client: Socket,
  @MessageBody() data: { store: string; type: string; token: string }
) {
  // Validar token antes de unir al room
  if (!this.validateToken(data.token)) {
    client.emit('error', 'Token inválido');
    return;
  }
  // ... resto del código
}
```

---

## 📝 Notas Finales

- ✅ Sistema completamente funcional
- ✅ Integrado con webhooks existentes
- ✅ No requiere cambios en la base de datos
- ✅ Compatible con el frontend actual
- ✅ Cliente de prueba incluido
- ✅ Documentación completa

**URLs del Servidor:**
- Local: `http://localhost:8080`
- Producción: `https://search-alegra-production-5eed.up.railway.app`

**Webhooks Activos:** 24 suscripciones (6 eventos × 4 tiendas)

**Eventos Soportados:**
- `new-invoice` → emite `invoice:created`
- `edit-invoice` → emite `invoice:updated`
- `delete-invoice` → emite `invoice:deleted`
- `new-bill` → emite `bill:created`
- `edit-bill` → emite `bill:updated`
- `delete-bill` → emite `bill:deleted`

---

## 🆘 Soporte y Troubleshooting

### Problema: No se reciben eventos

**Solución:**
1. Verifica que estás conectado: `socket.connected === true`
2. Confirma que te uniste al room correcto
3. Revisa los logs del servidor
4. Verifica que los webhooks estén activos en Alegra

### Problema: Conexión falla

**Solución:**
1. Verifica la URL del servidor
2. Comprueba CORS si estás en un dominio diferente
3. Intenta con transporte polling primero
4. Revisa la consola del navegador para errores

### Problema: Eventos duplicados

**Solución:**
1. Asegúrate de no unirte al mismo room múltiples veces
2. Limpia los listeners al desmontar componentes
3. Usa `socket.off()` antes de re-suscribirse

---

**Última actualización:** Octubre 26, 2025  
**Versión:** 1.0.0  
**Autor:** Sistema de Búsqueda Alegra
