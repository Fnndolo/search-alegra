# Instrucciones para implementar "Todas las tiendas" en el Frontend

## Resumen de cambios en el Backend

El backend ahora soporta una nueva opción llamada **"Todas las tiendas"** (valor: `'todas'`) que permite consultar facturas de venta y de compra de todas las tiendas simultáneamente.

### Cambios principales:

1. **Nueva opción válida**: `'todas'` se agregó como tienda válida junto a `'pasto'`, `'medellin'`, `'armenia'`, `'pereira'`.

2. **Nueva estructura de datos**: Cuando se consulta con `store=todas`, los objetos de factura/bill incluyen dos campos adicionales:
   - `tienda`: Nombre completo de la tienda (ej: "Smart Gadgets Pasto")
   - `storeKey`: Clave de la tienda (ej: "pasto")

3. **Ordenamiento**: Las facturas/bills de todas las tiendas se ordenan primero por `datetime` (fecha) y luego por `id`.

---

## Pasos para implementar en el Frontend

### 1. Agregar la opción "Todas las tiendas" al selector

Añade una nueva opción en tu componente de selección de tienda:

```html
<select v-model="selectedStore" @change="onStoreChange">
  <option value="pasto">Smart Gadgets Pasto</option>
  <option value="medellin">Smart Gadgets Medellín</option>
  <option value="armenia">Smart Gadgets Armenia</option>
  <option value="pereira">Smart Gadgets Pereira</option>
  <option value="todas">Todas las tiendas</option>
</select>
```

O en React:

```jsx
<select value={selectedStore} onChange={handleStoreChange}>
  <option value="pasto">Smart Gadgets Pasto</option>
  <option value="medellin">Smart Gadgets Medellín</option>
  <option value="armenia">Smart Gadgets Armenia</option>
  <option value="pereira">Smart Gadgets Pereira</option>
  <option value="todas">Todas las tiendas</option>
</select>
```

### 2. Modificar las llamadas al API

Las llamadas al API no cambian. Simplemente pasa `'todas'` como parámetro:

**Facturas de venta:**

```javascript
// Obtener facturas
GET /invoices/all?store=todas

// Respuesta esperada:
{
  "updating": false,
  "progress": 1250,
  "fullyLoaded": true,
  "data": [
    {
      "id": 123,
      "date": "2026-02-10",
      "numberTemplate": {...},
      "client": {...},
      "total": 150000,
      // NUEVOS CAMPOS cuando store=todas:
      "tienda": "Smart Gadgets Pasto",
      "storeKey": "pasto"
    },
    {
      "id": 456,
      "date": "2026-02-10",
      "numberTemplate": {...},
      "client": {...},
      "total": 250000,
      // NUEVOS CAMPOS cuando store=todas:
      "tienda": "Smart Gadgets Medellín",
      "storeKey": "medellin"
    }
    // ... más facturas de todas las tiendas
  ],
  "store": "todas",
  "storeDisplayName": "Todas las tiendas",
  "total": 1250
}
```

**Facturas de compra (Bills):**

```javascript
// Obtener bills
GET /bills/all?store=todas

// La estructura de respuesta es idéntica a la de invoices
```

### 3. Mostrar la columna "Tienda" condicionalmente

Solo muestra la columna "Tienda" cuando `selectedStore === 'todas'`:

**Ejemplo en Vue:**

```vue
<template>
  <table>
    <thead>
      <tr>
        <th>ID</th>
        <th>Fecha</th>
        <th>Cliente/Proveedor</th>
        <th>Total</th>
        <!-- Columna condicional -->
        <th v-if="selectedStore === 'todas'">Tienda</th>
        <th>Acciones</th>
      </tr>
    </thead>
    <tbody>
      <tr
        v-for="invoice in invoices"
        :key="`${invoice.storeKey}-${invoice.id}`"
      >
        <td>{{ invoice.id }}</td>
        <td>{{ invoice.date }}</td>
        <td>{{ invoice.client?.name || invoice.provider?.name }}</td>
        <td>{{ formatCurrency(invoice.total) }}</td>
        <!-- Celda condicional -->
        <td v-if="selectedStore === 'todas'">{{ invoice.tienda }}</td>
        <td>
          <button @click="viewDetails(invoice)">Ver</button>
        </td>
      </tr>
    </tbody>
  </table>
</template>
```

**Ejemplo en React:**

```jsx
<table>
  <thead>
    <tr>
      <th>ID</th>
      <th>Fecha</th>
      <th>Cliente/Proveedor</th>
      <th>Total</th>
      {selectedStore === 'todas' && <th>Tienda</th>}
      <th>Acciones</th>
    </tr>
  </thead>
  <tbody>
    {invoices.map((invoice) => (
      <tr key={`${invoice.storeKey}-${invoice.id}`}>
        <td>{invoice.id}</td>
        <td>{invoice.date}</td>
        <td>{invoice.client?.name || invoice.provider?.name}</td>
        <td>{formatCurrency(invoice.total)}</td>
        {selectedStore === 'todas' && <td>{invoice.tienda}</td>}
        <td>
          <button onClick={() => viewDetails(invoice)}>Ver</button>
        </td>
      </tr>
    ))}
  </tbody>
</table>
```

### 4. Actualizar las keys de los elementos

Cuando se muestra "Todas las tiendas", los IDs pueden repetirse entre tiendas diferentes. Para evitar conflictos en las keys, usa una combinación de `storeKey` e `id`:

```javascript
// ❌ Incorrecto (puede haber IDs duplicados)
key={invoice.id}

// ✅ Correcto (combinación única)
key={`${invoice.storeKey}-${invoice.id}`}
```

### 5. Gestionar filtros y búsquedas

Si implementas búsqueda/filtrado local, asegúrate de incluir el campo `tienda` en tus criterios cuando `selectedStore === 'todas'`:

```javascript
function filterInvoices(searchTerm) {
  return invoices.filter((invoice) => {
    const matchesId = invoice.id.toString().includes(searchTerm);
    const matchesClient = invoice.client?.name
      ?.toLowerCase()
      .includes(searchTerm.toLowerCase());
    const matchesStore =
      selectedStore === 'todas'
        ? invoice.tienda?.toLowerCase().includes(searchTerm.toLowerCase())
        : true;

    return matchesId || matchesClient || matchesStore;
  });
}
```

### 6. Gestionar detalles y acciones

Cuando el usuario hace clic en una factura/bill para ver detalles o editarla, asegúrate de pasar tanto el `id` como el `storeKey`:

```javascript
function viewDetails(invoice) {
  // Si estás en "todas", necesitas saber de qué tienda es
  const store = selectedStore === 'todas' ? invoice.storeKey : selectedStore;

  // Navegar o hacer la llamada al API con la tienda correcta
  router.push(`/invoices/${store}/${invoice.id}`);
  // O llamar al API:
  // fetch(`/invoices/single?store=${store}&id=${invoice.id}`)
}
```

### 7. Consideraciones de rendimiento

- La opción "Todas las tiendas" puede retornar muchos más registros que una tienda individual
- Considera implementar paginación o lazy loading si tienes muchas facturas
- El ordenamiento ya viene del backend (por fecha y luego por ID), no necesitas re-ordenar

### 8. Ejemplo completo de manejo del cambio de tienda

```javascript
// Estado
const [selectedStore, setSelectedStore] = useState('pasto');
const [invoices, setInvoices] = useState([]);
const [loading, setLoading] = useState(false);

// Función para cargar datos
async function loadInvoices(store) {
  setLoading(true);
  try {
    const response = await fetch(`/invoices/all?store=${store}`);
    const data = await response.json();
    setInvoices(data.data);
  } catch (error) {
    console.error('Error al cargar facturas:', error);
  } finally {
    setLoading(false);
  }
}

// Manejador de cambio
function handleStoreChange(event) {
  const newStore = event.target.value;
  setSelectedStore(newStore);
  loadInvoices(newStore);
}

// Cargar al montar
useEffect(() => {
  loadInvoices(selectedStore);
}, []);
```

---

## Endpoints que NO soportan "todas"

Los siguientes endpoints están diseñados para trabajar con tiendas individuales y lanzarán un error si se les pasa `store=todas`:

- `GET /invoices/update?store=todas` ❌
- `GET /invoices/reload?store=todas` ❌
- `GET /invoices/ensure-full-persistence?store=todas` ❌
- `GET /invoices/reload-with-payments?store=todas` ❌
- `GET /bills/update?store=todas` ❌
- `GET /bills/reload?store=todas` ❌
- `GET /bills/ensure-full-persistence?store=todas` ❌
- `GET /bills/reset-sync?store=todas` ❌

**Solución:** Si necesitas actualizar/recargar datos, debes hacerlo tienda por tienda:

```javascript
async function updateAllStores() {
  const stores = ['pasto', 'medellin', 'armenia', 'pereira'];

  for (const store of stores) {
    await fetch(`/invoices/update?store=${store}`);
  }

  // Ahora puedes cargar "todas"
  await loadInvoices('todas');
}
```

---

## Estructura de datos completa

### Factura de venta (Invoice) cuando store="todas"

```json
{
  "id": 123,
  "date": "2026-02-10",
  "datetime": "2026-02-10 15:30:45",
  "dueDate": "2026-02-24",
  "numberTemplate": {
    "id": 1,
    "number": "FV-123",
    "text": "Factura de venta",
    "documentType": "invoice"
  },
  "client": {
    "id": 456,
    "name": "Juan Pérez",
    "identification": "123456789"
  },
  "total": 150000,
  "totalPaid": 150000,
  "balance": 0,
  "status": "closed",
  "items": [...],
  "payments": [...],
  // CAMPOS ADICIONALES:
  "tienda": "Smart Gadgets Pasto",
  "storeKey": "pasto"
}
```

### Factura de compra (Bill) cuando store="todas"

```json
{
  "id": 789,
  "date": "2026-02-09",
  "datetime": "2026-02-09 10:15:30",
  "dueDate": "2026-02-23",
  "provider": {
    "id": 321,
    "name": "Proveedor XYZ",
    "identification": "987654321"
  },
  "total": 500000,
  "totalPaid": 250000,
  "balance": 250000,
  "status": "open",
  "items": [...],
  // CAMPOS ADICIONALES:
  "tienda": "Smart Gadgets Medellín",
  "storeKey": "medellin"
}
```

---

## Validación y testing

### Checklist de implementación:

- [ ] Agregar opción "Todas las tiendas" al selector
- [ ] Verificar que la llamada al API funciona con `store=todas`
- [ ] Mostrar columna "Tienda" solo cuando `selectedStore === 'todas'`
- [ ] Usar keys únicas: `${storeKey}-${id}`
- [ ] Incluir filtro por tienda en búsquedas (si aplica)
- [ ] Pasar `storeKey` correcto al ver detalles
- [ ] Manejar errores para endpoints que no soportan "todas"
- [ ] Probar con muchos registros (performance)
- [ ] Verificar ordenamiento por fecha e ID

### Casos de prueba:

1. **Seleccionar "Todas las tiendas"**
   - Debe mostrar facturas de todas las tiendas
   - Debe mostrar la columna "Tienda"
   - Debe ordenarse por fecha descendente

2. **Cambiar de "Todas las tiendas" a tienda individual**
   - Debe ocultar la columna "Tienda"
   - Debe mostrar solo facturas de la tienda seleccionada

3. **Verificar IDs duplicados**
   - Puede haber ID 123 en Pasto y ID 123 en Medellín
   - Se distinguen por la columna "Tienda"
   - No debe haber conflictos de keys en la tabla

4. **Ver detalles de una factura**
   - Debe abrir la factura correcta de la tienda correcta
   - No debe confundir IDs entre tiendas

---

## Ejemplo de implementación completa (Vue 3)

```vue
<template>
  <div class="invoices-container">
    <!-- Selector de tienda -->
    <div class="store-selector">
      <label for="store">Seleccionar tienda:</label>
      <select id="store" v-model="selectedStore" @change="loadInvoices">
        <option value="pasto">Smart Gadgets Pasto</option>
        <option value="medellin">Smart Gadgets Medellín</option>
        <option value="armenia">Smart Gadgets Armenia</option>
        <option value="pereira">Smart Gadgets Pereira</option>
        <option value="todas">Todas las tiendas</option>
      </select>
    </div>

    <!-- Indicador de carga -->
    <div v-if="loading" class="loading">Cargando facturas...</div>

    <!-- Tabla de facturas -->
    <table v-else class="invoices-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>Fecha</th>
          <th>Número</th>
          <th>Cliente</th>
          <th>Total</th>
          <th v-if="selectedStore === 'todas'">Tienda</th>
          <th>Estado</th>
          <th>Acciones</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="invoice in invoices"
          :key="`${invoice.storeKey || selectedStore}-${invoice.id}`"
        >
          <td>{{ invoice.id }}</td>
          <td>{{ formatDate(invoice.date) }}</td>
          <td>{{ invoice.numberTemplate.number }}</td>
          <td>{{ invoice.client.name }}</td>
          <td>{{ formatCurrency(invoice.total) }}</td>
          <td v-if="selectedStore === 'todas'">
            <span class="store-badge">{{ invoice.tienda }}</span>
          </td>
          <td>
            <span :class="`status-${invoice.status}`">
              {{ getStatusLabel(invoice.status) }}
            </span>
          </td>
          <td>
            <button @click="viewInvoice(invoice)">Ver</button>
            <button @click="printInvoice(invoice)">Imprimir</button>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- Sin resultados -->
    <div v-if="!loading && invoices.length === 0" class="no-results">
      No se encontraron facturas
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const selectedStore = ref('pasto');
const invoices = ref([]);
const loading = ref(false);

async function loadInvoices() {
  loading.value = true;
  try {
    const response = await fetch(
      `/api/invoices/all?store=${selectedStore.value}`,
    );
    const data = await response.json();
    invoices.value = data.data;
  } catch (error) {
    console.error('Error al cargar facturas:', error);
    alert('Error al cargar las facturas');
  } finally {
    loading.value = false;
  }
}

function viewInvoice(invoice) {
  const store =
    selectedStore.value === 'todas' ? invoice.storeKey : selectedStore.value;
  router.push(`/invoices/${store}/${invoice.id}`);
}

function printInvoice(invoice) {
  const store =
    selectedStore.value === 'todas' ? invoice.storeKey : selectedStore.value;
  window.open(`/api/invoices/print?store=${store}&id=${invoice.id}`, '_blank');
}

function formatDate(date) {
  return new Date(date).toLocaleDateString('es-CO');
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
  }).format(amount);
}

function getStatusLabel(status) {
  const labels = {
    open: 'Abierta',
    closed: 'Cerrada',
    draft: 'Borrador',
  };
  return labels[status] || status;
}

onMounted(() => {
  loadInvoices();
});
</script>

<style scoped>
.store-badge {
  padding: 4px 8px;
  background: #e3f2fd;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
}

.status-open {
  color: #f57c00;
}

.status-closed {
  color: #388e3c;
}

.status-draft {
  color: #757575;
}
</style>
```

---

## 🔌 WebSockets en Tiempo Real

El backend ahora soporta notificaciones en tiempo real para "Todas las tiendas" mediante WebSockets.

### Salas de WebSocket

Cuando te conectas al WebSocket, puedes unirte a las siguientes salas:

**Tiendas individuales:**

- `pasto-sales` - Facturas de venta de Pasto
- `pasto-purchases` - Facturas de compra de Pasto
- `medellin-sales` - Facturas de venta de Medellín
- `medellin-purchases` - Facturas de compra de Medellín
- `armenia-sales` - Facturas de venta de Armenia
- `armenia-purchases` - Facturas de compra de Armenia
- `pereira-sales` - Facturas de venta de Pereira
- `pereira-purchases` - Facturas de compra de Pereira

**Todas las tiendas (NUEVO):**

- `todas-sales` - Facturas de venta de TODAS las tiendas
- `todas-purchases` - Facturas de compra de TODAS las tiendas

### Conectar y unirse a una sala

```javascript
import io from 'socket.io-client';

// Conectar al servidor WebSocket
const socket = io('http://localhost:3000', {
  transports: ['websocket', 'polling'],
});

// Unirse a una sala según la tienda seleccionada
function joinRoom(store, type) {
  // type puede ser 'sales' o 'purchases'
  socket.emit('join:room', { store, type });
}

// Ejemplo: Unirse a la sala de facturas de venta de todas las tiendas
joinRoom('todas', 'sales');

// Ejemplo: Unirse a la sala de facturas de compra de una tienda específica
joinRoom('pasto', 'purchases');
```

### Eventos disponibles

#### Facturas de Venta (Invoices)

**1. `invoice:created` - Factura creada**

Cuando se crea una factura en cualquier tienda:

```javascript
// Para tienda específica (ej: pasto-sales)
socket.on('invoice:created', (invoice) => {
  console.log('Nueva factura creada:', invoice);
  // invoice NO incluye campos tienda/storeKey
  // porque ya sabes que es de la tienda que seleccionaste
});

// Para TODAS las tiendas (todas-sales)
socket.on('invoice:created', (invoice) => {
  console.log('Nueva factura creada:', invoice);
  console.log('De la tienda:', invoice.tienda); // "Smart Gadgets Pasto"
  console.log('Store key:', invoice.storeKey); // "pasto"

  // INCLUYE campos adicionales:
  // - tienda: "Smart Gadgets Pasto"
  // - storeKey: "pasto"
});
```

**2. `invoice:updated` - Factura actualizada**

```javascript
socket.on('invoice:updated', (invoice) => {
  console.log('Factura actualizada:', invoice);

  // Si estás en "todas-sales", incluye:
  // - tienda: "Smart Gadgets Medellín"
  // - storeKey: "medellin"
});
```

**3. `invoice:deleted` - Factura eliminada**

```javascript
// Para tienda específica
socket.on('invoice:deleted', (invoiceId) => {
  console.log('Factura eliminada ID:', invoiceId); // Solo el ID (número)
});

// Para TODAS las tiendas
socket.on('invoice:deleted', (data) => {
  console.log('Factura eliminada:', data);
  // data = {
  //   id: 123,
  //   storeKey: "armenia",
  //   tienda: "Smart Gadgets Armenia"
  // }
});
```

#### Facturas de Compra (Bills)

Los mismos eventos pero con prefijo `bill:` en lugar de `invoice:`

**1. `bill:created`**
**2. `bill:updated`**
**3. `bill:deleted`**

### Implementación completa

```javascript
import io from 'socket.io-client';
import { ref, watch } from 'vue';

// Estado
const selectedStore = ref('pasto');
const invoices = ref([]);
const socket = io('http://localhost:3000', {
  transports: ['websocket', 'polling'],
});

// Variable para guardar la sala actual
let currentRoom = null;

// Función para cambiar de sala
function switchRoom(store, type = 'sales') {
  // Salir de la sala anterior
  if (currentRoom) {
    socket.emit('leave:room', currentRoom);
  }

  // Unirse a la nueva sala
  const newRoom = { store, type };
  socket.emit('join:room', newRoom);
  currentRoom = newRoom;

  console.log(`Cambiado a sala: ${store}-${type}`);
}

// Escuchar eventos de facturas
socket.on('invoice:created', (invoice) => {
  console.log('📥 Nueva factura recibida:', invoice);

  // Si estás en "todas", el invoice incluye tienda y storeKey
  // Si estás en una tienda específica, NO incluye esos campos

  invoices.value = [invoice, ...invoices.value];
});

socket.on('invoice:updated', (invoice) => {
  console.log('🔄 Factura actualizada:', invoice);

  const index = invoices.value.findIndex((inv) => {
    // Si estás en "todas", comparar también por storeKey
    if (selectedStore.value === 'todas') {
      return inv.id === invoice.id && inv.storeKey === invoice.storeKey;
    }
    // Si es tienda específica, solo comparar por ID
    return inv.id === invoice.id;
  });

  if (index !== -1) {
    invoices.value[index] = invoice;
  }
});

socket.on('invoice:deleted', (data) => {
  console.log('🗑️ Factura eliminada:', data);

  // Si estás en "todas", data es un objeto { id, storeKey, tienda }
  // Si es tienda específica, data es solo el ID
  const invoiceId = typeof data === 'object' ? data.id : data;
  const storeKey =
    typeof data === 'object' ? data.storeKey : selectedStore.value;

  invoices.value = invoices.value.filter((inv) => {
    if (selectedStore.value === 'todas') {
      return !(inv.id === invoiceId && inv.storeKey === storeKey);
    }
    return inv.id !== invoiceId;
  });
});

// Cambiar de sala cuando cambia la tienda seleccionada
watch(selectedStore, (newStore) => {
  switchRoom(newStore, 'sales');
  // Recargar datos desde el API
  loadInvoices(newStore);
});

// Inicializar: unirse a la sala al montar el componente
switchRoom(selectedStore.value, 'sales');
```

### Ejemplo completo en Vue 3 con WebSockets

```vue
<template>
  <div class="invoices-container">
    <!-- Selector de tienda -->
    <div class="store-selector">
      <label for="store">Seleccionar tienda:</label>
      <select id="store" v-model="selectedStore">
        <option value="pasto">Smart Gadgets Pasto</option>
        <option value="medellin">Smart Gadgets Medellín</option>
        <option value="armenia">Smart Gadgets Armenia</option>
        <option value="pereira">Smart Gadgets Pereira</option>
        <option value="todas">Todas las tiendas</option>
      </select>
    </div>

    <!-- Indicador de conexión -->
    <div class="connection-status" :class="{ connected: isConnected }">
      {{ isConnected ? '🟢 Conectado' : '🔴 Desconectado' }}
    </div>

    <!-- Tabla de facturas -->
    <table class="invoices-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>Fecha</th>
          <th>Cliente</th>
          <th>Total</th>
          <th v-if="selectedStore === 'todas'">Tienda</th>
          <th>Acciones</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="invoice in invoices"
          :key="`${invoice.storeKey || selectedStore}-${invoice.id}`"
          :class="{ 'new-invoice': invoice.isNew }"
        >
          <td>{{ invoice.id }}</td>
          <td>{{ formatDate(invoice.date) }}</td>
          <td>{{ invoice.client.name }}</td>
          <td>{{ formatCurrency(invoice.total) }}</td>
          <td v-if="selectedStore === 'todas'">
            <span class="store-badge">{{ invoice.tienda }}</span>
          </td>
          <td>
            <button @click="viewInvoice(invoice)">Ver</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue';
import io from 'socket.io-client';

const selectedStore = ref('pasto');
const invoices = ref([]);
const isConnected = ref(false);
let socket = null;
let currentRoom = null;

// Inicializar WebSocket
function initializeWebSocket() {
  socket = io('http://localhost:3000', {
    transports: ['websocket', 'polling'],
  });

  socket.on('connect', () => {
    console.log('✅ Conectado al WebSocket');
    isConnected.value = true;
    switchRoom(selectedStore.value, 'sales');
  });

  socket.on('disconnect', () => {
    console.log('❌ Desconectado del WebSocket');
    isConnected.value = false;
  });

  // Eventos de facturas
  socket.on('invoice:created', handleInvoiceCreated);
  socket.on('invoice:updated', handleInvoiceUpdated);
  socket.on('invoice:deleted', handleInvoiceDeleted);
}

// Cambiar de sala
function switchRoom(store, type = 'sales') {
  if (!socket) return;

  if (currentRoom) {
    socket.emit('leave:room', currentRoom);
  }

  const newRoom = { store, type };
  socket.emit('join:room', newRoom);
  currentRoom = newRoom;
}

// Manejar nueva factura
function handleInvoiceCreated(invoice) {
  console.log('📥 Nueva factura:', invoice);

  // Agregar efecto visual temporal
  invoice.isNew = true;
  invoices.value = [invoice, ...invoices.value];

  // Remover efecto después de 3 segundos
  setTimeout(() => {
    invoice.isNew = false;
  }, 3000);
}

// Manejar factura actualizada
function handleInvoiceUpdated(invoice) {
  console.log('🔄 Factura actualizada:', invoice);

  const index = invoices.value.findIndex((inv) => {
    if (selectedStore.value === 'todas') {
      return inv.id === invoice.id && inv.storeKey === invoice.storeKey;
    }
    return inv.id === invoice.id;
  });

  if (index !== -1) {
    invoices.value[index] = invoice;
  }
}

// Manejar factura eliminada
function handleInvoiceDeleted(data) {
  console.log('🗑️ Factura eliminada:', data);

  const invoiceId = typeof data === 'object' ? data.id : data;
  const storeKey =
    typeof data === 'object' ? data.storeKey : selectedStore.value;

  invoices.value = invoices.value.filter((inv) => {
    if (selectedStore.value === 'todas') {
      return !(inv.id === invoiceId && inv.storeKey === storeKey);
    }
    return inv.id !== invoiceId;
  });
}

// Cargar facturas desde el API
async function loadInvoices() {
  try {
    const response = await fetch(
      `/api/invoices/all?store=${selectedStore.value}`,
    );
    const data = await response.json();
    invoices.value = data.data;
  } catch (error) {
    console.error('Error al cargar facturas:', error);
  }
}

// Formatear fecha
function formatDate(date) {
  return new Date(date).toLocaleDateString('es-CO');
}

// Formatear moneda
function formatCurrency(amount) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
  }).format(amount);
}

// Ver factura
function viewInvoice(invoice) {
  const store =
    selectedStore.value === 'todas' ? invoice.storeKey : selectedStore.value;
  console.log(`Ver factura ${invoice.id} de ${store}`);
}

// Observar cambios en la tienda seleccionada
watch(selectedStore, (newStore) => {
  switchRoom(newStore, 'sales');
  loadInvoices();
});

// Ciclo de vida
onMounted(() => {
  initializeWebSocket();
  loadInvoices();
});

onUnmounted(() => {
  if (socket) {
    socket.disconnect();
  }
});
</script>

<style scoped>
.connection-status {
  padding: 8px 16px;
  border-radius: 4px;
  margin-bottom: 16px;
  background: #ffebee;
  color: #c62828;
}

.connection-status.connected {
  background: #e8f5e9;
  color: #2e7d32;
}

.new-invoice {
  animation: highlight 3s ease-out;
}

@keyframes highlight {
  0% {
    background-color: #fff9c4;
  }
  100% {
    background-color: transparent;
  }
}
</style>
```

### Diferencias importantes entre salas específicas y "todas"

| Aspecto                  | Tienda específica (`pasto-sales`) | Todas las tiendas (`todas-sales`)  |
| ------------------------ | --------------------------------- | ---------------------------------- |
| **invoice:created**      | Solo datos de la factura          | Incluye `tienda` y `storeKey`      |
| **invoice:updated**      | Solo datos de la factura          | Incluye `tienda` y `storeKey`      |
| **invoice:deleted**      | Solo el `invoiceId` (número)      | Objeto: `{ id, storeKey, tienda }` |
| **Identificación única** | Por `id`                          | Por `id` + `storeKey`              |

### Checklist de WebSockets

- [ ] Instalar socket.io-client: `npm install socket.io-client`
- [ ] Conectar al servidor WebSocket
- [ ] Implementar función para unirse/salir de salas
- [ ] Escuchar eventos `invoice:created`, `invoice:updated`, `invoice:deleted`
- [ ] Manejar estructura diferente para eventos de "todas"
- [ ] Actualizar la lista local cuando llegan eventos
- [ ] Cambiar de sala cuando el usuario cambia de tienda
- [ ] Mostrar indicador de conexión
- [ ] Desconectar al desmontar el componente

---

## ¿Preguntas frecuentes?

### ¿Puedo actualizar todas las tiendas a la vez?

No directamente desde la opción "todas". Debes actualizar cada tienda individualmente y luego consultar "todas".

### ¿Los IDs se duplicarán?

Sí, diferentes tiendas pueden tener el mismo ID. Usa la columna "Tienda" o el campo `storeKey` para distinguirlas.

### ¿El ordenamiento es correcto?

Sí, el backend ordena por `datetime` (fecha) descendente y luego por `id` descendente.

### ¿Afecta el rendimiento?

Puede retornar más datos, así que considera implementar paginación o virtualización si tienes muchas facturas.

---

## Resumen de cambios necesarios

1. ✅ Agregar opción "Todas las tiendas" al selector
2. ✅ Mostrar columna "Tienda" condicionalmente
3. ✅ Usar keys únicas combinando `storeKey` e `id`
4. ✅ Pasar `storeKey` correcto al ver detalles/acciones
5. ✅ Actualizar filtros/búsquedas para incluir el campo `tienda`
6. ✅ Evitar llamar a endpoints de actualización con `store=todas`
7. ✅ **Implementar WebSockets para actualizaciones en tiempo real**
8. ✅ **Unirse a sala `todas-sales` o `todas-purchases` cuando se seleccione "todas"**
9. ✅ **Manejar estructura diferente de eventos para sala "todas"**

---

**¡Listo!** Con estos cambios, tu frontend estará preparado para mostrar facturas de todas las tiendas con la nueva columna de identificación y actualizaciones en tiempo real mediante WebSockets. 🎉
